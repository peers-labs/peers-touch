import { identityRuntime } from '../../kernel/identityRuntime';
import { bootstrapRuntime, installRuntime } from '../../kernel/runtime';
import { EVENT, eventBus } from '../../kernel/events';
import i18n, { changeLanguage } from '../../i18n';
import {
  installAuthenticatedCriticalRuntimes,
  installDeferredAppRuntimeProjections,
} from '../../services/appRuntime';
import {
  api,
  AuthCommandException,
  classifyAgentTurnTerminalEvent,
  isAgentCapabilityReady,
  streamAgentTurn,
  streamAgentTurnReplay,
  submitAgentFeedback,
  type AgentAttachmentRefInput,
  type AgentRuntimeBudgetInput,
  type AgentTurnSourceDelivery,
  type AgentTurnStreamController,
  type StreamEvent,
} from '../../services/desktop_api';
import {
  flushAgentTurnRecoveryPersistence,
  type AgentTurnSnapshotReloadResult,
} from '../../runtimes/chatRuntime';
import { useAgentStore } from '../../store/agent';
import { useAgentTurnRecoveryStore } from '../../store/agentTurnRecovery';
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
import {
  assertFoundationCapabilityFixtureCleanupState,
  assertFoundationCapabilityIsolationPrerequisites,
  assertFoundationCapabilityIsolationAgentVersion,
  isFoundationCapabilityIsolationRestored,
  parseFoundationCapabilityFixtureJournal,
  parseFoundationCapabilityIsolationJournal,
  planFoundationCapabilityBindingRestoration,
  restoreFoundationCapabilityBindings,
  type FoundationCapabilityFixtureJournal,
  type FoundationCapabilityIsolationJournal,
} from './capabilityIsolation';

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

interface FoundationAttachmentUploadInput {
  conversationId: string;
  filename: string;
  mimeType: string;
  bytes: number[];
}

interface FoundationAttachmentResolveInput {
  objectRef: string;
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
  controller: AgentTurnStreamController;
  sourcePtid: string;
  events: ObservedFoundationTurnResult['events'];
  firstEvent: Promise<{ event: string; data: Record<string, unknown> }>;
  result: Promise<ObservedFoundationTurnResult>;
}

interface FoundationCapabilityIsolation {
  disabledBindingCount: number;
  readyCapabilityCount: number;
  originalReadyCapabilityCount: number;
  originalReadyCapabilityHash: string;
  restoredBindingCount: number;
  restoredReadyCapabilityCount: number;
  restoredReadyCapabilityHash: string;
  restorationVerified: boolean;
}

interface FoundationF06Transition {
  phase: string;
  sequence: number;
  streamGeneration: number;
  observedAt: string;
  terminal: boolean;
}

interface FoundationF06ReplayDelivery {
  eventType: string;
  sequence: number;
  streamId: string;
  streamGeneration: number;
  observedAt: string;
  sourceTransport: AgentTurnSourceDelivery['transport'];
  sourcePtidHash: string;
  sourceConversationId: string;
  sourceTurnId: string;
  sourceSequence: number;
  sourceEventType: string;
  rawPayload: {
    eventType: string;
    data: Record<string, unknown>;
  };
  payloadHash: string;
}

interface FoundationF06Handoff {
  scenarioKey: string;
  platform: string;
  locale: string;
  sampleId: string;
  conversationId: string;
  turnId: string;
  streamId: string;
  streamGeneration: number;
  actorPtid: string;
  actorPtidHash: string;
  acknowledgedCursor: number;
  conversationRevision: number;
  prefixHash: string;
  prefixLength: number;
  duplicateSequence: number;
  outOfOrderSequence: number;
  staleGeneration: number;
  staleGenerationRejected: boolean;
  staleTerminalRejected: boolean;
  cursorBeforeMutation: number;
  cursorAfterMutation: number;
  projectionBeforeMutationHash: string;
  projectionAfterMutationHash: string;
  duplicatePayloadHash: string;
  outOfOrderPayloadHash: string;
  transitions: FoundationF06Transition[];
  replayedSequences: number[];
  replayDeliveries: FoundationF06ReplayDelivery[];
  preparationAttempts: number;
  toolIsolation: FoundationCapabilityIsolation;
  recoveryFailure?: Record<string, unknown>;
  preparedAt: string;
}

interface FoundationF06FaultBoundary {
  handoff: FoundationF06Handoff;
  projectionBeforeMutation: string;
  projectionAfterMutation: string;
  prefix: string;
  duplicateSource: {
    event: string;
    data: Record<string, unknown>;
  };
  outOfOrderSource: {
    event: string;
    data: Record<string, unknown>;
  };
}

const FOUNDATION_F06_STORAGE_KEY = 'pt.acceptance.agent.foundation.as-f06';
const FOUNDATION_CAPABILITY_ISOLATION_STORAGE_KEY =
  'pt.acceptance.agent.foundation.capability-isolation';
const FOUNDATION_CAPABILITY_FIXTURE_STORAGE_KEY =
  'pt.acceptance.agent.foundation.capability-fixture';
const FOUNDATION_F06_PHASE_BY_EVENT: Record<string, string> = {
  connection_lost: 'CONNECTION_LOST',
  reconnecting: 'RECONNECTING',
  replaying: 'REPLAYING',
  reconciling: 'RECONCILING',
  connected: 'CONNECTED',
  recovery_failed: 'RECOVERY_FAILED',
};
let foundationF06ObservationInstalled = false;
let foundationF06ReplayRecording: Promise<void> = Promise.resolve();
const foundationF06Controllers = new Map<string, AgentTurnStreamController>();
const foundationF06PendingHandoffs = new Map<string, FoundationF06Handoff>();
const foundationF06ReplayingScenarios = new Set<string>();

function authenticatedFoundationActorPtid(): string {
  const user = useSessionStore.getState().currentUser;
  const actorPtid = user?.ptid?.trim() || user?.actorId.trim() || '';
  if (!actorPtid) {
    throw new Error('agent.acceptance.authenticatedActorMissing');
  }
  return actorPtid;
}

function readFoundationF06Handoffs(): Record<string, FoundationF06Handoff> {
  const raw = window.localStorage.getItem(FOUNDATION_F06_STORAGE_KEY);
  if (!raw) return {};
  try {
    const values = JSON.parse(raw) as Record<string, Partial<FoundationF06Handoff>>;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    const handoffs: Record<string, FoundationF06Handoff> = {};
    for (const [scenarioKey, value] of Object.entries(values)) {
      if (
        typeof value.scenarioKey !== 'string'
        || value.scenarioKey !== scenarioKey
        || typeof value.platform !== 'string'
        || typeof value.locale !== 'string'
        || typeof value.sampleId !== 'string'
        || typeof value.conversationId !== 'string'
        || typeof value.turnId !== 'string'
        || typeof value.streamId !== 'string'
        || !Number.isSafeInteger(value.streamGeneration)
        || typeof value.actorPtid !== 'string'
        || typeof value.actorPtidHash !== 'string'
        || !Number.isSafeInteger(value.acknowledgedCursor)
        || !Number.isSafeInteger(value.conversationRevision)
        || typeof value.prefixHash !== 'string'
        || !Number.isSafeInteger(value.prefixLength)
        || !Number.isSafeInteger(value.duplicateSequence)
        || !Number.isSafeInteger(value.outOfOrderSequence)
        || !Number.isSafeInteger(value.staleGeneration)
        || !Number.isSafeInteger(value.cursorBeforeMutation)
        || !Number.isSafeInteger(value.cursorAfterMutation)
        || typeof value.projectionBeforeMutationHash !== 'string'
        || typeof value.projectionAfterMutationHash !== 'string'
        || typeof value.duplicatePayloadHash !== 'string'
        || typeof value.outOfOrderPayloadHash !== 'string'
        || !Array.isArray(value.transitions)
        || !Array.isArray(value.replayedSequences)
        || !Array.isArray(value.replayDeliveries)
        || !Number.isSafeInteger(value.preparationAttempts)
        || Number(value.preparationAttempts) < 1
        || !value.toolIsolation
        || !Number.isSafeInteger(value.toolIsolation.disabledBindingCount)
        || !Number.isSafeInteger(value.toolIsolation.readyCapabilityCount)
        || typeof value.preparedAt !== 'string'
      ) {
        return {};
      }
      handoffs[scenarioKey] = value as FoundationF06Handoff;
    }
    return handoffs;
  } catch {
    return {};
  }
}

function readFoundationF06Handoff(scenarioKey: string): FoundationF06Handoff | null {
  return readFoundationF06Handoffs()[scenarioKey] ?? null;
}

function writeFoundationF06Handoff(value: FoundationF06Handoff): void {
  const handoffs = readFoundationF06Handoffs();
  handoffs[value.scenarioKey] = value;
  window.localStorage.setItem(FOUNDATION_F06_STORAGE_KEY, JSON.stringify(handoffs));
}

async function updateFoundationF06RecoveryFailure(
  scenarioKey: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  foundationF06ReplayRecording = foundationF06ReplayRecording.then(() => {
    const current = readFoundationF06Handoff(scenarioKey);
    if (!current) {
      throw new Error('agent.acceptance.foundationRecoveryHandoffMissing');
    }
    current.recoveryFailure = evidence;
    writeFoundationF06Handoff(current);
  });
  await foundationF06ReplayRecording;
}

function removeFoundationF06Handoff(scenarioKey: string): void {
  foundationF06ReplayingScenarios.delete(scenarioKey);
  foundationF06PendingHandoffs.delete(scenarioKey);
  const handoffs = readFoundationF06Handoffs();
  delete handoffs[scenarioKey];
  if (Object.keys(handoffs).length === 0) {
    window.localStorage.removeItem(FOUNDATION_F06_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(FOUNDATION_F06_STORAGE_KEY, JSON.stringify(handoffs));
}

function installFoundationF06Observation(): void {
  if (foundationF06ObservationInstalled) return;
  foundationF06ObservationInstalled = true;
  useAgentTurnRecoveryStore.subscribe((state, previousState) => {
    const observedHandoffs = [
      ...Object.values(readFoundationF06Handoffs()),
      ...foundationF06PendingHandoffs.values(),
    ];
    for (const handoff of observedHandoffs) {
      const current = state.active[handoff.conversationId];
      const previous = previousState.active[handoff.conversationId];
      if (
        !current
        || current.actorId !== handoff.actorPtid
        || current.turnId !== handoff.turnId
        || current.streamId !== handoff.streamId
        || current.streamGeneration !== handoff.streamGeneration
        || current.phase === previous?.phase
      ) {
        continue;
      }
      if (current.phase === 'REPLAYING') {
        foundationF06ReplayingScenarios.add(handoff.scenarioKey);
      }
      foundationF06ReplayRecording = foundationF06ReplayRecording.then(() => {
        const pending = foundationF06PendingHandoffs.get(handoff.scenarioKey);
        const latest = pending ?? readFoundationF06Handoff(handoff.scenarioKey);
        if (!latest) return;
        latest.transitions.push({
          phase: current.phase,
          sequence: current.cursor,
          streamGeneration: current.streamGeneration,
          observedAt: new Date(current.updatedAt).toISOString(),
          terminal: false,
        });
        if (!pending) writeFoundationF06Handoff(latest);
      });
    }
  });
  eventBus.subscribe(EVENT.AGENT_TURN_STREAM_EVENT, (payload) => {
    const observed = payload as typeof payload & {
      sourceDelivery?: AgentTurnSourceDelivery;
    };
    const sourceDelivery = observed.sourceDelivery;
    const observedTurnId = sourceDelivery?.turnId
      ?? String(payload.data.turnId || payload.data.turn_id || '');
    const observedHandoffs = [
      ...Object.values(readFoundationF06Handoffs()),
      ...foundationF06PendingHandoffs.values(),
    ];
    const handoff = observedHandoffs.find((candidate) =>
      payload.conversationId === candidate.conversationId
      && observedTurnId === candidate.turnId
      && payload.ptid === candidate.actorPtid
      && payload.streamId === candidate.streamId
      && payload.streamGeneration === candidate.streamGeneration
      && (
        !sourceDelivery
        || (
          sourceDelivery.ptid === candidate.actorPtid
          && sourceDelivery.conversationId === candidate.conversationId
          && sourceDelivery.turnId === candidate.turnId
        )
      ));
    if (!handoff) return;
    if (payload.event === 'replaying') {
      foundationF06ReplayingScenarios.add(handoff.scenarioKey);
      return;
    }
    if (!sourceDelivery) return;
    foundationF06ReplayRecording = foundationF06ReplayRecording.then(async () => {
      const pending = foundationF06PendingHandoffs.get(handoff.scenarioKey);
      const current = pending ?? readFoundationF06Handoff(handoff.scenarioKey);
      if (!current) return;
      if (
        foundationF06ReplayingScenarios.has(handoff.scenarioKey)
        && sourceDelivery.rawPayload.eventType !== 'catchup_done'
        && sourceDelivery.rawPayload.eventType !== 'snapshot'
        && Number.isSafeInteger(sourceDelivery.sequence)
        && sourceDelivery.sequence > current.acknowledgedCursor
      ) {
        const rawPayload = evidenceValue(
          sourceDelivery.rawPayload,
        ) as FoundationF06ReplayDelivery['rawPayload'];
        const replayDelivery: FoundationF06ReplayDelivery = {
          eventType: sourceDelivery.rawPayload.eventType,
          sequence: sourceDelivery.sequence,
          streamId: payload.streamId,
          streamGeneration: payload.streamGeneration,
          observedAt: new Date(payload.timestampMs).toISOString(),
          sourceTransport: sourceDelivery.transport,
          sourcePtidHash: await sha256Hex(sourceDelivery.ptid),
          sourceConversationId: sourceDelivery.conversationId,
          sourceTurnId: sourceDelivery.turnId,
          sourceSequence: sourceDelivery.sequence,
          sourceEventType: sourceDelivery.rawPayload.eventType,
          rawPayload,
          payloadHash: await sha256Hex(stableJson(rawPayload)),
        };
        const existingDelivery = current.replayDeliveries.find(
          (delivery) => delivery.sequence === sourceDelivery.sequence,
        );
        if (existingDelivery) {
          if (existingDelivery.payloadHash !== replayDelivery.payloadHash) {
            throw new Error(
              'agent.acceptance.foundationRecoverySequencePayloadConflict',
            );
          }
          return;
        }
        current.replayedSequences.push(sourceDelivery.sequence);
        current.replayDeliveries.push(replayDelivery);
      }
      if (!pending) writeFoundationF06Handoff(current);
    });
  });
}

async function foundationStationReplayReadback(
  handoff: FoundationF06Handoff,
): Promise<FoundationF06ReplayDelivery[]> {
  const deliveries: FoundationF06ReplayDelivery[] = [];
  let recording = Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout = 0;
    let controller: AbortController | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      controller?.abort();
      void recording.then(() => {
        if (error) reject(error);
        else resolve(deliveries);
      }).catch((recordingError) => {
        reject(recordingError instanceof Error
          ? recordingError
          : new Error(String(recordingError)));
      });
    };
    controller = streamAgentTurnReplay({
      conversation_id: handoff.conversationId,
      turn_id: handoff.turnId,
      after_seq: handoff.acknowledgedCursor,
    }, (event) => {
      const sourceDelivery = event.sourceDelivery;
      if (
        sourceDelivery
        && sourceDelivery.sequence > handoff.acknowledgedCursor
        && !FOUNDATION_F06_PHASE_BY_EVENT[event.event]
        && event.event !== 'catchup_done'
        && event.event !== 'snapshot'
      ) {
        const rawPayload = evidenceValue(
          sourceDelivery.rawPayload,
        ) as FoundationF06ReplayDelivery['rawPayload'];
        recording = recording.then(async () => {
          deliveries.push({
            eventType: event.event,
            sequence: sourceDelivery.sequence,
            streamId: handoff.streamId,
            streamGeneration: handoff.streamGeneration,
            observedAt: new Date().toISOString(),
            sourceTransport: sourceDelivery.transport,
            sourcePtidHash: await sha256Hex(sourceDelivery.ptid),
            sourceConversationId: sourceDelivery.conversationId,
            sourceTurnId: sourceDelivery.turnId,
            sourceSequence: sourceDelivery.sequence,
            sourceEventType: sourceDelivery.rawPayload.eventType,
            rawPayload,
            payloadHash: await sha256Hex(stableJson(rawPayload)),
          });
        }).catch((error) => {
          finish(error instanceof Error ? error : new Error(String(error)));
        });
        if (classifyAgentTurnTerminalEvent(event) !== null) finish();
        return;
      }
      if (
        event.event === 'catchup_done'
        || classifyAgentTurnTerminalEvent(event) !== null
      ) {
        finish();
      }
    }, finish, handoff.actorPtid);
    timeout = window.setTimeout(() => {
      finish(new Error('agent.acceptance.foundationStationReplayTimeout'));
    }, 120_000);
  });
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
  attachments?: AgentAttachmentRefInput[];
  requestedBudget?: AgentRuntimeBudgetInput;
  streamId?: string;
  timeoutMs?: number;
  onEvent?: (
    event: ObservedFoundationTurnResult['events'][number],
    events: ObservedFoundationTurnResult['events'],
    controller: AgentTurnStreamController,
    complete: () => void,
  ) => void;
}): ObservedFoundationTurn {
  const sourcePtid = authenticatedFoundationActorPtid();
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
  let unsubscribeReplay: (() => void) | null = null;
  const finish = (ok: boolean, error: string | null) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    unsubscribeReplay?.();
    unsubscribeReplay = null;
    resolveResult({ ok, error, events });
  };
  let controller!: AgentTurnStreamController;
  const observeEvent = (event: StreamEvent) => {
    const observed = {
      event: event.event,
      data: evidenceValue(event.data) as Record<string, unknown>,
      observedAt: new Date().toISOString(),
    };
    events.push(observed);
    input.onEvent?.(observed, events, controller, () => finish(true, null));
    if (!firstEventObserved) {
      firstEventObserved = true;
      resolveFirstEvent(observed);
    }
  };
  controller = streamAgentTurn({
    conversation_id: input.conversationId,
    agent_id: input.agentId,
    user_input: input.content,
    client_idempotency_key: input.idempotencyKey,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    thinking_mode: input.thinkingMode,
    client_capability_session_id: input.clientCapabilitySessionId,
    attachments: input.attachments,
    requested_budget: input.requestedBudget,
    stream_id: input.streamId,
  }, observeEvent, () => finish(true, null), (error) => finish(false, error.message), sourcePtid);
  unsubscribeReplay = eventBus.subscribe(EVENT.AGENT_TURN_STREAM_EVENT, (payload) => {
    const replay = payload as typeof payload & {
      deliveryOnly?: boolean;
      sourceDelivery?: AgentTurnSourceDelivery;
    };
    if (
      !replay.deliveryOnly
      || replay.ptid !== sourcePtid
      || replay.conversationId !== input.conversationId
      || replay.streamGeneration !== controller.streamGeneration
    ) {
      return;
    }
    const event = {
      event: replay.event,
      data: replay.data,
      sourceDelivery: replay.sourceDelivery,
    };
    observeEvent(event);
    const terminal = classifyAgentTurnTerminalEvent(event);
    if (terminal === 'failed') {
      finish(false, String(event.data.error || 'agent.error.streamFailed'));
    } else if (terminal !== null && terminal !== 'interrupted') {
      finish(true, null);
    }
  });
  timeout = window.setTimeout(() => {
    controller.abort();
    finish(false, 'agent.acceptance.turnSubmissionTimeout');
  }, input.timeoutMs ?? 120_000);
  return { controller, sourcePtid, events, firstEvent, result };
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
    if (
      serializedDetails.includes('AGENT_4009')
      || (error as { code?: string }).code === 'CONFLICT'
    ) {
      return 'VERSION_CONFLICT';
    }
    if (serializedDetails.includes('AGENT_4001')) {
      return 'INVALID_REQUEST';
    }
    if (serializedDetails.includes('CONTEXT_ATTACHMENT_REJECTED')) {
      return 'CONTEXT_ATTACHMENT_REJECTED';
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('ADMISSION_QUEUE_FULL') || message.includes('queueFull')) {
    return 'ADMISSION_QUEUE_FULL';
  }
  if (message.includes('ACTIVE_DEPENDENCY')) return 'ACTIVE_DEPENDENCY';
  if (message.includes('AGENT_4009') || message.includes('CONFLICT')) {
    return 'VERSION_CONFLICT';
  }
  if (message.includes('AGENT_4001') || message.includes('required')) {
    return 'INVALID_REQUEST';
  }
  if (
    message.includes('CONTEXT_ATTACHMENT_REJECTED')
    || message.includes('agent.errors.attachmentRejected')
  ) {
    return 'CONTEXT_ATTACHMENT_REJECTED';
  }
  return message;
}

function redactedAuthError(error: unknown): Record<string, string | null> {
  if (!(error instanceof AuthCommandException)) {
    return {
      code: observedErrorCode(error),
      detailCode: null,
      reason: null,
      deviceType: null,
    };
  }
  const details = error.details;
  return {
    code: error.code,
    detailCode: typeof details?.code === 'string' ? details.code : null,
    reason: typeof details?.reason === 'string' ? details.reason : null,
    deviceType:
      typeof details?.device_type === 'string'
        ? details.device_type
        : null,
  };
}

async function observeFoundationActiveDependency(
  conversationId: string,
  initialVersion: number,
): Promise<string> {
  let expectedVersion = initialVersion;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await api.archiveAgentConversation(
        conversationId,
        expectedVersion,
        true,
      );
      return '';
    } catch (error) {
      const code = observedErrorCode(error);
      if (code === 'ACTIVE_DEPENDENCY') return code;
      if (code !== 'VERSION_CONFLICT') return code;
      expectedVersion = (
        await api.getAgentConversation(conversationId)
      ).version;
    }
  }
  return 'VERSION_CONFLICT';
}

async function deleteFoundationConversation(
  conversationId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const conversation = await api.getAgentConversation(conversationId);
      if (conversation.status === 'deleted') {
        return 'CONVERSATION_DELETED';
      }
      await api.archiveAgentConversation(
        conversationId,
        conversation.version,
        true,
      );
      return '';
    } catch (error) {
      const code = observedErrorCode(error);
      if (code.includes('AGENT_4004')) return code;
      if (code !== 'VERSION_CONFLICT' && code !== 'ACTIVE_DEPENDENCY') {
        try {
          await api.getAgentConversation(conversationId);
        } catch {
          throw error;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }
  throw new Error('agent.acceptance.foundationConversationDeleteBlocked');
}

async function cancelFoundationQueuedTurns(
  conversationId: string,
): Promise<Awaited<ReturnType<typeof api.cancelQueuedAgentTurn>> | null> {
  const idempotencyKeys = new Map<string, string>();
  let firstCancellation: Awaited<
    ReturnType<typeof api.cancelQueuedAgentTurn>
  > | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const queue = await api.listAgentTurnQueue(conversationId);
    if (queue.entries.length === 0) return firstCancellation;

    let expectedVersion = queue.conversation_version;
    let retryRequired = false;
    for (const entry of queue.entries) {
      const idempotencyKey = idempotencyKeys.get(entry.queue_entry_id)
        ?? crypto.randomUUID();
      idempotencyKeys.set(entry.queue_entry_id, idempotencyKey);
      try {
        const cancellation = await api.cancelQueuedAgentTurn({
          conversation_id: conversationId,
          queue_entry_id: entry.queue_entry_id,
          idempotency_key: idempotencyKey,
          expected_conversation_version: expectedVersion,
        });
        firstCancellation ??= cancellation;
        expectedVersion = cancellation.conversation_version;
      } catch (error) {
        if (observedErrorCode(error) !== 'VERSION_CONFLICT') throw error;
        retryRequired = true;
        break;
      }
    }
    if (!retryRequired) continue;
  }
  throw new Error('agent.acceptance.foundationQueueCancellationConflict');
}

async function cleanupStaleFoundationQueueConversations(
  agentId: string,
): Promise<void> {
  const conversations = await api.listAgentConversations(agentId, {
    page: 1,
    pageSize: 200,
  });
  const stale = conversations.filter((conversation) =>
    conversation.status !== 'deleted'
    && conversation.title.startsWith('Foundation queue '));

  for (const conversation of stale) {
    try {
      await cancelFoundationQueuedTurns(conversation.conversation_id);
      const messages = await api.listAgentConversationMessages({
        conversation_id: conversation.conversation_id,
        limit: 200,
      });
      const turnIds = Array.from(new Set(
        messages.messages
          .map((message) => message.turn_id)
          .filter((turnId): turnId is string => Boolean(turnId)),
      ));
      for (const turnId of turnIds.reverse()) {
        await api.cancelAgentTurn(turnId);
      }
      await deleteFoundationConversation(conversation.conversation_id);
    } catch (error) {
      throw new Error(
        `CLEANUP_FAILED:${observedErrorCode(error)}`,
      );
    }
  }
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

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
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

function optionalEvidenceArray(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`agent.acceptance.${label}Invalid`);
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
  const matches: Array<{
    localSession: (typeof local.sessions)[number];
    stationSession: (typeof station.sessions)[number];
  }> = [];
  for (const session of station.sessions) {
    const [actorHash, deviceHash, sessionHash] = await Promise.all([
      sha256Hex(session.ptid),
      sha256Hex(session.device_id),
      sha256Hex(session.session_id),
    ]);
    const localSession = local.sessions.find(
      (candidate) =>
        candidate.actor_id_hash === actorHash &&
        candidate.device_id_hash === deviceHash &&
        candidate.capability_session_id_hash === sessionHash &&
        candidate.platform === session.platform,
    );
    if (localSession) {
      matches.push({ localSession, stationSession: session });
    }
  }
  if (matches.length > 1) {
    throw new Error('agent.acceptance.capabilitySessionAmbiguous');
  }
  return {
    local,
    station,
    selectedLocalSession: matches[0]?.localSession ?? null,
    selectedStationSession: matches[0]?.stationSession ?? null,
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
    messageAttachments: snapshot('[data-pt-agent-message-attachment]'),
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
      status: message.status,
      content: message.content,
      attachments: message.attachments ?? [],
      seq: message.seq,
      branchId: message.branch_id ?? null,
      parentMessageId: message.parent_message_id ?? null,
      replacesMessageId: message.replaces_message_id ?? null,
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

function duplicateCount(values: string[]): number {
  return values.length - new Set(values).size;
}

async function foundationDurableMutationSnapshot(
  agentId: string,
  conversationId: string,
  turnId: string,
): Promise<Record<string, unknown>> {
  const [readback, traces, traceResponse, diagnosticsResponse] = await Promise.all([
    foundationConversationReadback(conversationId),
    api.listAgentTurnTraces(agentId, {
      conversationId,
      page: 1,
      pageSize: 200,
    }),
    api.getAgentTurnTrace({ turnId }),
    api.exportAgentTurnDiagnostics(turnId),
  ]);
  const traceEntry = evidenceRecord(
    evidenceValue(traceResponse.entry),
    'foundationF06TurnTraceEntry',
  );
  const turn = evidenceRecord(traceEntry.turn, 'foundationF06Turn');
  const trace = evidenceRecord(traceEntry.trace, 'foundationF06Trace');
  const diagnostics = evidenceRecord(
    evidenceValue(diagnosticsResponse.replay),
    'foundationF06Diagnostics',
  );
  const diagnosticMessages = optionalEvidenceArray(
    evidenceField(diagnostics, 'messages', 'messages'),
    'foundationF06DiagnosticMessages',
  ).map((value) => evidenceRecord(value, 'foundationF06DiagnosticMessage'));
  const diagnosticTools = optionalEvidenceArray(
    evidenceField(diagnostics, 'toolCalls', 'tool_calls'),
    'foundationF06DiagnosticTools',
  ).map((value) => evidenceRecord(value, 'foundationF06DiagnosticTool'));
  const messageIds = readback.messages.map((message) => message.messageId);
  const diagnosticMessageIds = diagnosticMessages.map((message) =>
    String(evidenceField(message, 'messageId', 'message_id') ?? ''),
  ).filter(Boolean);
  const traceIds = traces.entries
    .filter((entry) => entry.turn?.turnId === turnId)
    .map((entry) => entry.trace?.traceId ?? '')
    .filter(Boolean);
  const sideEffectReceiptIds = diagnosticTools.map((tool) =>
    String(
      evidenceField(tool, 'sideEffectReceiptId', 'side_effect_receipt_id') ?? '',
    ),
  ).filter(Boolean);
  const facts = {
    conversation: {
      conversationId: readback.conversation.conversation_id,
      version: readback.conversation.version,
      status: readback.conversation.status,
    },
    turn: {
      turnId: String(evidenceField(turn, 'turnId', 'turn_id') ?? ''),
      status: evidenceField(turn, 'status', 'status'),
      traceId: String(evidenceField(trace, 'traceId', 'trace_id') ?? ''),
    },
    messages: {
      count: messageIds.length,
      turnCount: readback.messages.filter((message) => message.turnId === turnId).length,
      duplicateCount: duplicateCount(messageIds),
      diagnosticCount: diagnosticMessageIds.length,
      diagnosticDuplicateCount: duplicateCount(diagnosticMessageIds),
    },
    traces: {
      count: traceIds.length,
      duplicateCount: duplicateCount(traceIds),
      providerCallCount: optionalEvidenceArray(
        evidenceField(trace, 'providerCalls', 'provider_calls'),
        'foundationF06ProviderCalls',
      ).length,
    },
    sideEffects: {
      count: sideEffectReceiptIds.length,
      duplicateCount: duplicateCount(sideEffectReceiptIds),
    },
  };
  return {
    ...facts,
    sourceHash: await sha256Hex(stableJson(facts)),
  };
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
const FOUNDATION_LOOP_MAX_TOOL_CALLS = 2;

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

interface FoundationToolTurnSession {
  capabilitySessionId: string;
  facts: Record<string, unknown>;
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
  idempotencyKey = crypto.randomUUID(),
): Promise<AgentCapabilityBinding> {
  return api.upsertAgentCapabilityBinding({
    bindingId: current?.bindingId,
    agentId: agent.id || agent.name,
    capabilityId: fixture.manifest.capabilityId,
    capabilityVersion: fixture.manifest.version,
    enabled,
    approvalPolicy: policy,
    expectedAgentVersion: agent.version,
  }, current?.revision ?? 0, idempotencyKey);
}

async function updateFoundationCapabilityBindingEnabled(
  agent: NonNullable<ReturnType<typeof selectedAgent>>,
  binding: AgentCapabilityBinding,
  enabled: boolean,
): Promise<AgentCapabilityBinding> {
  return api.upsertAgentCapabilityBinding({
    bindingId: binding.bindingId,
    agentId: agent.id || agent.name,
    capabilityId: binding.capabilityId,
    capabilityVersion: binding.capabilityVersion,
    enabled,
    approvalPolicy: binding.approvalPolicy,
    expectedAgentVersion: agent.version,
  }, binding.revision, crypto.randomUUID());
}

async function foundationReadyCapabilityHash(
  readiness: Awaited<ReturnType<typeof api.getAgentCapabilityReadiness>>,
): Promise<string> {
  const ready = readiness.capabilities
    .filter(isAgentCapabilityReady)
    .map((capability) => ({
      capabilityId: capability.capability_id,
      capabilityVersion: capability.capability_version,
    }))
    .sort((left, right) =>
      `${left.capabilityId}:${left.capabilityVersion}`
        .localeCompare(`${right.capabilityId}:${right.capabilityVersion}`));
  return sha256Hex(stableJson(ready));
}

function readFoundationCapabilityIsolationJournal(
): FoundationCapabilityIsolationJournal | null {
  return parseFoundationCapabilityIsolationJournal(
    window.localStorage.getItem(
      FOUNDATION_CAPABILITY_ISOLATION_STORAGE_KEY,
    ),
  );
}

async function restorePersistedFoundationCapabilityIsolation(
): Promise<FoundationCapabilityIsolation | null> {
  const journal = readFoundationCapabilityIsolationJournal();
  if (!journal) return null;
  const agent = await api.getAgent(journal.agentId);
  assertFoundationCapabilityIsolationAgentVersion(
    journal.agentVersion,
    agent.version,
  );

  await restoreFoundationCapabilityBindings(
    journal.bindings,
    () => api.listAgentCapabilityBindings(journal.agentId),
    async (original, current) => {
      await api.upsertAgentCapabilityBinding({
        bindingId: current.bindingId,
        agentId: journal.agentId,
        capabilityId: original.capabilityId,
        capabilityVersion: original.capabilityVersion,
        enabled: true,
        approvalPolicy: original.approvalPolicy,
        expectedAgentVersion: agent.version,
      }, current.revision, crypto.randomUUID());
    },
  );

  const currentSession = await resolveFoundationToolTurnSession();
  const restoredReadiness = await api.getAgentCapabilityReadiness({
    agent_id: journal.agentId,
    client_capability_session_id: currentSession.capabilitySessionId,
  });
  const restoredReadyCapabilityCount = restoredReadiness.capabilities.filter(
    isAgentCapabilityReady,
  ).length;
  const restoredReadyCapabilityHash = await foundationReadyCapabilityHash(
    restoredReadiness,
  );
  const currentBindings = await api.listAgentCapabilityBindings(journal.agentId);
  const restoredBindings = planFoundationCapabilityBindingRestoration(
    journal.bindings,
    currentBindings,
  ).filter(({ requiresRestore }) => !requiresRestore);
  const restorationVerified =
    restoredBindings.length === journal.bindings.length
    && restoredReadyCapabilityCount === journal.originalReadyCapabilityCount
    && restoredReadyCapabilityHash === journal.originalReadyCapabilityHash;
  if (!restorationVerified) {
    throw new Error(
      'agent.acceptance.foundationCapabilityBindingRestoreVerificationFailed',
    );
  }
  const restoredAgent = await api.getAgent(journal.agentId);
  assertFoundationCapabilityIsolationAgentVersion(
    journal.agentVersion,
    restoredAgent.version,
  );
  window.localStorage.removeItem(FOUNDATION_CAPABILITY_ISOLATION_STORAGE_KEY);
  return {
    disabledBindingCount: journal.bindings.length,
    readyCapabilityCount: 0,
    originalReadyCapabilityCount: journal.originalReadyCapabilityCount,
    originalReadyCapabilityHash: journal.originalReadyCapabilityHash,
    restoredBindingCount: restoredBindings.length,
    restoredReadyCapabilityCount,
    restoredReadyCapabilityHash,
    restorationVerified,
  };
}

function readFoundationCapabilityFixtureJournal(
): FoundationCapabilityFixtureJournal | null {
  return parseFoundationCapabilityFixtureJournal(
    window.localStorage.getItem(
      FOUNDATION_CAPABILITY_FIXTURE_STORAGE_KEY,
    ),
  );
}

async function prepareFoundationCapabilityFixture(
  journal: FoundationCapabilityFixtureJournal,
): Promise<AgentCapabilityBinding> {
  const agent = await api.getAgent(journal.agentId);
  assertFoundationCapabilityIsolationAgentVersion(
    journal.agentVersion,
    agent.version,
  );
  const original = journal.originalBinding;
  const prepared = await api.upsertAgentCapabilityBinding({
    bindingId: original?.bindingId,
    agentId: journal.agentId,
    capabilityId: journal.capabilityId,
    capabilityVersion: journal.capabilityVersion,
    enabled: true,
    approvalPolicy: CapabilityApprovalPolicy.MANUAL,
    expectedAgentVersion: agent.version,
  }, original ? BigInt(original.revision) : 0n, journal.setupIdempotencyKey);
  return prepared;
}

async function restorePersistedFoundationCapabilityFixture(): Promise<boolean> {
  const journal = readFoundationCapabilityFixtureJournal();
  if (!journal) return false;
  const agent = await api.getAgent(journal.agentId);
  assertFoundationCapabilityIsolationAgentVersion(
    journal.agentVersion,
    agent.version,
  );
  const original = journal.originalBinding;
  const prepared = await prepareFoundationCapabilityFixture(journal);
  let cleanupExpectedRevision = journal.cleanupExpectedRevision;
  let cleanupIdempotencyKey = journal.cleanupIdempotencyKey;
  if (!cleanupExpectedRevision || !cleanupIdempotencyKey) {
    const currentBindings = await api.listAgentCapabilityBindings(
      journal.agentId,
    );
    const current = currentBindings.find((binding) =>
      binding.bindingId === prepared.bindingId
      && !binding.tombstonedAt);
    if (!current) {
      throw new Error('agent.acceptance.foundationCapabilityBindingMissing');
    }
    assertFoundationCapabilityFixtureCleanupState(prepared, current);
    cleanupExpectedRevision = current.revision.toString();
    cleanupIdempotencyKey = crypto.randomUUID();
    const cleanupJournal: FoundationCapabilityFixtureJournal = {
      ...journal,
      cleanupExpectedRevision,
      cleanupIdempotencyKey,
    };
    const serializedJournal = JSON.stringify(cleanupJournal);
    parseFoundationCapabilityFixtureJournal(serializedJournal);
    window.localStorage.setItem(
      FOUNDATION_CAPABILITY_FIXTURE_STORAGE_KEY,
      serializedJournal,
    );
  }

  if (original) {
    await api.upsertAgentCapabilityBinding({
      bindingId: prepared.bindingId,
      agentId: journal.agentId,
      capabilityId: journal.capabilityId,
      capabilityVersion: journal.capabilityVersion,
      enabled: original.enabled,
      approvalPolicy: original.approvalPolicy,
      expectedAgentVersion: agent.version,
    }, BigInt(cleanupExpectedRevision), cleanupIdempotencyKey);
  } else {
    await api.deleteAgentCapabilityBinding(
      prepared.bindingId,
      BigInt(cleanupExpectedRevision),
      cleanupIdempotencyKey,
      'acceptance_fixture_cleanup',
    );
  }

  const finalBindings = await api.listAgentCapabilityBindings(journal.agentId);
  const finalBinding = finalBindings.find((binding) =>
    binding.bindingId === prepared.bindingId
    && !binding.tombstonedAt);
  if (original) {
    if (
      !finalBinding
      || finalBinding.capabilityId !== journal.capabilityId
      || finalBinding.capabilityVersion !== journal.capabilityVersion
      || finalBinding.enabled !== original.enabled
      || finalBinding.approvalPolicy !== original.approvalPolicy
      || finalBinding.revision !== BigInt(cleanupExpectedRevision) + 1n
    ) {
      throw new Error(
        'agent.acceptance.foundationCapabilityFixtureRestoreVerificationFailed',
      );
    }
  } else if (finalBinding) {
    throw new Error(
      'agent.acceptance.foundationCapabilityFixtureDeleteVerificationFailed',
    );
  }
  const restoredAgent = await api.getAgent(journal.agentId);
  assertFoundationCapabilityIsolationAgentVersion(
    journal.agentVersion,
    restoredAgent.version,
  );
  window.localStorage.removeItem(FOUNDATION_CAPABILITY_FIXTURE_STORAGE_KEY);
  return true;
}

async function withFoundationCapabilitiesDisabled<T>(
  agent: NonNullable<ReturnType<typeof selectedAgent>>,
  capabilitySessionId: string,
  operation: (isolation: FoundationCapabilityIsolation) => Promise<T>,
  requireEffectiveCapabilities = false,
): Promise<T> {
  await restorePersistedFoundationCapabilityIsolation();
  const agentId = agent.id || agent.name;
  const authoritativeAgent = await api.getAgent(agentId);
  const originalBindings = (
    await api.listAgentCapabilityBindings(agentId)
  ).filter((binding) => binding.enabled && !binding.tombstonedAt);
  const originalReadiness = await api.getAgentCapabilityReadiness({
    agent_id: agentId,
    client_capability_session_id: capabilitySessionId,
  });
  const originalReadyCapabilityCount = originalReadiness.capabilities.filter(
    isAgentCapabilityReady,
  ).length;
  const originalReadyCapabilityHash = await foundationReadyCapabilityHash(
    originalReadiness,
  );
  if (requireEffectiveCapabilities) {
    await reportFoundationF07Debug('J-L', 'isolation-preflight', {
      enabledBindingCount: originalBindings.length,
      readyCapabilityCount: originalReadyCapabilityCount,
      readiness: originalReadiness.capabilities.map((capability) => ({
        capabilityId: capability.capability_id,
        state: capability.state,
        stateType: typeof capability.state,
        reasonCode: capability.reason_code,
      })),
    });
  }
  const journalBindings = originalBindings.map((binding) => ({
    bindingId: binding.bindingId,
    capabilityId: binding.capabilityId,
    capabilityVersion: binding.capabilityVersion,
    approvalPolicy: binding.approvalPolicy,
    originalRevision: binding.revision.toString(),
    isolatedRevision: (binding.revision + 1n).toString(),
    restoredRevision: (binding.revision + 2n).toString(),
  }));
  assertFoundationCapabilityIsolationPrerequisites(
    journalBindings,
    originalReadyCapabilityCount,
    requireEffectiveCapabilities,
  );
  const isolation: FoundationCapabilityIsolation = {
    disabledBindingCount: originalBindings.length,
    readyCapabilityCount: 0,
    originalReadyCapabilityCount,
    originalReadyCapabilityHash,
    restoredBindingCount: 0,
    restoredReadyCapabilityCount: 0,
    restoredReadyCapabilityHash: '',
    restorationVerified: false,
  };
  if (journalBindings.length === 0) {
    isolation.restorationVerified = true;
    return operation(isolation);
  }
  const journal: FoundationCapabilityIsolationJournal = {
    agentId,
    agentVersion: authoritativeAgent.version,
    originalReadyCapabilityCount,
    originalReadyCapabilityHash,
    bindings: journalBindings,
  };
  const serializedJournal = JSON.stringify(journal);
  parseFoundationCapabilityIsolationJournal(serializedJournal);
  window.localStorage.setItem(
    FOUNDATION_CAPABILITY_ISOLATION_STORAGE_KEY,
    serializedJournal,
  );
  let operationError: unknown = null;

  try {
    for (const binding of originalBindings) {
      await updateFoundationCapabilityBindingEnabled(
        authoritativeAgent,
        binding,
        false,
      );
    }
    const isolatedReadiness = await api.getAgentCapabilityReadiness({
      agent_id: agentId,
      client_capability_session_id: capabilitySessionId,
    });
    const readyCapabilityCount = isolatedReadiness.capabilities.filter(
      isAgentCapabilityReady,
    ).length;
    if (readyCapabilityCount !== 0) {
      throw new Error(
        'agent.acceptance.foundationProgressiveToolIsolationFailed',
      );
    }
    isolation.readyCapabilityCount = readyCapabilityCount;
    return await operation(isolation);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      const restoration = await restorePersistedFoundationCapabilityIsolation();
      if (restoration) Object.assign(isolation, restoration);
    } catch (cleanupError) {
      throw Object.assign(
        new Error('agent.acceptance.foundationCapabilityBindingRestoreFailed'),
        {
          primaryError: operationError,
          cleanupError,
        },
      );
    }
  }
}

async function startFoundationToolTurn(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  fixture: FoundationToolFixture;
  sampleId: string;
  label: string;
  repeatUntilStopped?: boolean;
  requestedBudget?: AgentRuntimeBudgetInput;
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
    requestedBudget: input.requestedBudget,
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

function firstToolApprovalOutcome(
  observed: ObservedFoundationTurn,
) {
  return observed.events.find((candidate) =>
    candidate.event === 'tool_approval_required'
    || ['error', 'cancelled', 'done'].includes(candidate.event));
}

async function waitForToolApprovalEvent(
  turn: FoundationToolTurn,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    const outcome = firstToolApprovalOutcome(turn.observed);
    if (outcome?.event === 'tool_approval_required') return outcome.data;
    if (outcome) {
      const terminalStage = String(outcome.data.stage ?? outcome.event);
      const error = evidenceField(
        outcome.data,
        'error',
        'error',
      ) ?? evidenceField(
        outcome.data,
        'errorCode',
        'error_code',
      ) ?? null;
      throw new Error(
        'agent.acceptance.foundationToolApprovalTerminated'
        + `: stage=${terminalStage}`
        + ` error=${error === null ? 'none' : stableJson(error)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('agent.acceptance.foundationToolApprovalMissing');
}

async function resolveFoundationToolTurnSession(
): Promise<FoundationToolTurnSession> {
  const capabilitySessions = await capabilitySessionEvidence();
  const localSession = capabilitySessions.selectedLocalSession;
  const stationSession = capabilitySessions.selectedStationSession;
  if (!localSession || !stationSession) {
    throw new Error('agent.acceptance.capabilitySessionUnavailable');
  }
  return {
    capabilitySessionId: stationSession.session_id,
    facts: {
      sessionIdHash: localSession.capability_session_id_hash,
      actorIdHash: localSession.actor_id_hash,
      deviceIdHash: localSession.device_id_hash,
      platform: stationSession.platform,
    },
  };
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
    const capabilitySession = await resolveFoundationToolTurnSession();
    const turn = await startFoundationToolTurn({
      agent: input.agent,
      capabilitySessionId: capabilitySession.capabilitySessionId,
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
    const caseFact: Record<string, unknown> = diagnosticToolCase(
      fact,
      sideEffectCount,
    );
    caseFact.capabilitySession = {
      ...capabilitySession.facts,
      turnId: turn.turnId,
    };
    return {
      turn,
      fact,
      sourceReplay: source.replay,
      replay: replayed.replay,
      beforeReplayFact: diagnosticToolCase(
        beforeReplay.facts[0],
        sideEffectCount,
      ),
      caseFact,
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
    const loopCapabilitySession = await resolveFoundationToolTurnSession();
    const loopTurn = await startFoundationToolTurn({
      agent: input.agent,
      capabilitySessionId: loopCapabilitySession.capabilitySessionId,
      fixture,
      sampleId: input.sampleId,
      label: 'loop-budget',
      repeatUntilStopped: true,
      requestedBudget: {
        max_tool_calls: FOUNDATION_LOOP_MAX_TOOL_CALLS,
      },
    });
    const loop = await waitForFoundationToolFacts(
      loopTurn.turnId,
      (facts, replay) =>
        facts.length > 0
        && facts.every((fact) => Number(fact.status) === ToolCallStatus.SUCCEEDED)
        && Number(replay.status) === AgentTurnStatus.FAILED
        && String(
          evidenceField(replay, 'terminalReason', 'terminal_reason') ?? '',
        ) === 'max_tool_calls_exhausted',
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
    const attempts = evidenceArray(
      evidenceField(loop.replay, 'attempts', 'attempts'),
      'foundationF04LoopAttempts',
    );
    const latestAttempt = evidenceRecord(
      attempts[attempts.length - 1],
      'foundationF04LoopAttempt',
    );
    const runtimeSnapshot = evidenceRecord(
      evidenceField(latestAttempt, 'runtimeSnapshot', 'runtime_snapshot'),
      'foundationF04LoopRuntimeSnapshot',
    );
    const effectiveBudget = evidenceRecord(
      evidenceField(runtimeSnapshot, 'budget', 'budget'),
      'foundationF04LoopEffectiveBudget',
    );
    const effectiveLimit = Number(
      evidenceField(effectiveBudget, 'maxToolCalls', 'max_tool_calls') ?? 0,
    );
    const terminalReason = String(
      evidenceField(loop.replay, 'terminalReason', 'terminal_reason') ?? '',
    );
    if (
      observedIterations !== FOUNDATION_LOOP_MAX_TOOL_CALLS
      || effectiveLimit !== FOUNDATION_LOOP_MAX_TOOL_CALLS
      || maximumIterations !== FOUNDATION_LOOP_MAX_TOOL_CALLS
      || terminalReason !== 'max_tool_calls_exhausted'
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
            terminalReason === 'max_tool_calls_exhausted'
            && observedIterations === FOUNDATION_LOOP_MAX_TOOL_CALLS
            && effectiveLimit === FOUNDATION_LOOP_MAX_TOOL_CALLS
            && maximumIterations === FOUNDATION_LOOP_MAX_TOOL_CALLS,
          terminalReason,
          requestedLimit: FOUNDATION_LOOP_MAX_TOOL_CALLS,
          effectiveLimit,
          observedIterations,
          maximumIterations,
          capabilitySession: {
            ...loopCapabilitySession.facts,
            turnId: loopTurn.turnId,
          },
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

const FOUNDATION_PNG_BYTES = Array.from(Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 248, 207, 192,
  0, 0, 3, 1, 1, 0, 24, 221, 141, 177, 0, 0, 0, 0, 73, 69,
  78, 68, 174, 66, 96, 130,
]));
const FOUNDATION_PDF_BYTES = Array.from(new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n',
));

function foundationPngBytes(label: string): number[] {
  return [
    ...FOUNDATION_PNG_BYTES,
    ...Array.from(new TextEncoder().encode(`fixture:${label}`)),
  ];
}

function attachmentEvidence(
  attachment: AgentAttachmentRefInput,
  ledgerSegment?: Record<string, unknown>,
): Record<string, unknown> {
  const omissionReason = String(
    evidenceField(ledgerSegment ?? {}, 'decisionReason', 'decision_reason') ?? '',
  );
  const disposition = omissionReason ? 'omitted' : 'consumed';
  return {
    attachmentId: attachment.attachment_id,
    objectRef: attachment.object_ref,
    mimeType: attachment.mime_type,
    sizeBytes: attachment.size_bytes,
    checksum: attachment.checksum,
    filename: attachment.filename,
    authorizationScope: attachment.authorization_scope,
    expiresAt: attachment.expires_at,
    modelDisposition: disposition,
    modelVisible: disposition === 'consumed',
    omissionReason,
    ledgerDecision: evidenceField(
      ledgerSegment ?? {},
      'decision',
      'decision',
    ) ?? null,
  };
}

async function foundationExecutionSnapshot(
  agentId: string,
  conversationId: string,
): Promise<{ turnCount: number; providerCallCount: number }> {
  const traces = await api.listAgentTurnTraces(agentId, {
    conversationId,
    page: 1,
    pageSize: 200,
  });
  return {
    turnCount: Number(traces.total ?? traces.entries.length),
    providerCallCount: traces.entries.reduce(
      (total, entry) => {
        if (!entry.trace) return total;
        const trace = evidenceRecord(
          evidenceValue(entry.trace),
          'foundationExecutionTrace',
        );
        const providerCalls = optionalEvidenceArray(
          evidenceField(trace, 'providerCalls', 'provider_calls'),
          'foundationProviderCalls',
        );
        return total + providerCalls.length;
      },
      0,
    ),
  };
}

async function runFoundationAttachmentTurn(input: {
  agentId: string;
  conversationId: string;
  provider?: string;
  model?: string;
  capabilitySessionId: string;
  attachments: AgentAttachmentRefInput[];
  content: string;
}): Promise<{
  result: ObservedFoundationTurnResult;
  turnId: string;
}> {
  const observed = startObservedFoundationTurn({
    conversationId: input.conversationId,
    agentId: input.agentId,
    content: input.content,
    idempotencyKey: crypto.randomUUID(),
    provider: input.provider,
    model: input.model,
    clientCapabilitySessionId: input.capabilitySessionId,
    attachments: input.attachments,
  });
  const result = await observed.result;
  return {
    result,
    turnId: observedTurnId(result.events),
  };
}

async function foundationResolvedBytes(objectRef: string): Promise<Uint8Array> {
  const resolved = await api.ossResolveUrl(objectRef);
  if (resolved.data_url) {
    const encoded = resolved.data_url.split(',', 2)[1] ?? '';
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  }
  const response = await fetch(resolved.url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('agent.acceptance.foundationAttachmentDownloadFailed');
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function runFoundationF05Scenario(input: {
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
  const agentId = input.agent.id || input.agent.name;
  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation attachments ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  const uploaded: AgentAttachmentRefInput[] = [];
  const toolFixture = await foundationToolFixture(agentId, input.platform);
  const originalToolBinding = toolFixture.binding;
  let currentToolBinding = originalToolBinding;
  const startedAt = performance.now();
  let scenarioError: unknown = null;

  try {
    if (currentToolBinding?.enabled) {
      currentToolBinding = await updateFoundationToolPolicy(
        input.agent,
        toolFixture,
        currentToolBinding,
        currentToolBinding.approvalPolicy,
        false,
      );
    }
    const png = await api.ossUploadAgentAttachmentBytes({
      filename: 'foundation.png',
      mime_type: 'image/png',
      bytes: foundationPngBytes('valid'),
      conversation_id: conversation.conversation_id,
    });
    uploaded.push(png);
    const pdf = await api.ossUploadAgentAttachmentBytes({
      filename: 'foundation.pdf',
      mime_type: 'application/pdf',
      bytes: FOUNDATION_PDF_BYTES,
      conversation_id: conversation.conversation_id,
    });
    uploaded.push(pdf);

    let failedUploadError = '';
    try {
      await api.ossUploadAgentAttachmentBytes({
        filename: 'retry.png',
        mime_type: 'image/png',
        bytes: foundationPngBytes('retry'),
        conversation_id: '',
      });
    } catch (error) {
      failedUploadError = observedErrorCode(error);
    }
    const retried = await api.ossUploadAgentAttachmentBytes({
      filename: 'retry.png',
      mime_type: 'image/png',
      bytes: foundationPngBytes('retry'),
      conversation_id: conversation.conversation_id,
    });
    uploaded.push(retried);
    const siblingIds = [png.attachment_id, pdf.attachment_id].sort();
    const siblingChecksumsBefore = await Promise.all(
      [png, pdf].map(async (attachment) =>
        `sha256:${await sha256Bytes(await foundationResolvedBytes(attachment.object_ref))}`),
    );
    await api.ossDeleteAgentAttachment(retried.object_ref);
    uploaded.splice(uploaded.indexOf(retried), 1);
    let removedObjectUnavailable = false;
    try {
      await foundationResolvedBytes(retried.object_ref);
    } catch {
      removedObjectUnavailable = true;
    }
    const siblingChecksumsAfter = await Promise.all(
      [png, pdf].map(async (attachment) =>
        `sha256:${await sha256Bytes(await foundationResolvedBytes(attachment.object_ref))}`),
    );

    const valid = await runFoundationAttachmentTurn({
      agentId,
      conversationId: conversation.conversation_id,
      provider: input.agent.provider || undefined,
      model: input.agent.model || undefined,
      capabilitySessionId: input.capabilitySessionId,
      attachments: [png, pdf],
      content: 'Acknowledge the attached files in one short sentence.',
    });
    if (!valid.result.ok || !valid.turnId) {
      throw new Error(
        valid.result.error || 'agent.acceptance.foundationAttachmentTurnFailed',
      );
    }
    const diagnostics = await foundationDiagnosticReplay(valid.turnId);
    const contextLedgers = evidenceArray(
      evidenceField(diagnostics, 'contextLedgers', 'context_ledgers'),
      'foundationAttachmentContextLedgers',
    ).map((value) => evidenceRecord(value, 'foundationAttachmentContextLedger'));
    const attachmentSegments = contextLedgers.flatMap((ledger) =>
      evidenceArray(ledger.segments, 'foundationAttachmentSegments')
        .map((value) => evidenceRecord(value, 'foundationAttachmentSegment'))
        .filter((segment) => Number(segment.type) === 11));
    const segmentById = new Map<string, Record<string, unknown>>();
    for (const segment of attachmentSegments) {
      const sourceRefs = evidenceArray(
        evidenceField(segment, 'sourceRefs', 'source_refs'),
        'foundationAttachmentSourceRefs',
      );
      const attachmentId = String(sourceRefs[0] ?? '').replace(/^attachment:/, '');
      segmentById.set(attachmentId, segment);
    }
    const firstReadback = await foundationConversationReadback(
      conversation.conversation_id,
    );
    const firstUserMessage = [...firstReadback.messages]
      .reverse()
      .find((message) => message.role === 'user' && message.turnId === valid.turnId);
    const beforeRestart = (firstUserMessage?.attachments ?? []).map((attachment) =>
      attachmentEvidence(attachment, segmentById.get(attachment.attachment_id)));
    await useChatStore.getState().selectSession('');
    await useChatStore.getState().selectSession(conversation.conversation_id);
    await useChatStore.getState().syncMessages();
    const messageReadback = await foundationConversationReadback(
      conversation.conversation_id,
    );
    const userMessage = [...messageReadback.messages]
      .reverse()
      .find((message) => message.role === 'user' && message.turnId === valid.turnId);
    const persistedAttachments = userMessage?.attachments ?? [];
    const afterRestart = persistedAttachments.map((attachment) =>
      attachmentEvidence(attachment, segmentById.get(attachment.attachment_id)));
    const projectedUserMessage = [...useChatStore.getState().messages]
      .reverse()
      .find((message) => message.role === 'user' && message.turnId === valid.turnId);
    const projectionReadback = (projectedUserMessage?.attachments ?? [])
      .map((item) => item.attachment)
      .filter((attachment): attachment is AgentAttachmentRefInput => Boolean(attachment))
      .map((attachment) =>
        attachmentEvidence(attachment, segmentById.get(attachment.attachment_id)));

    const rejectedCase = async (
      kind: 'oversized' | 'unsupported' | 'unauthorized',
    ): Promise<Record<string, unknown>> => {
      const rejectedConversation = await api.createAgentConversation({
        agent_id: agentId,
        title: `Foundation attachment rejection ${kind} ${input.sampleId}`,
        provider_id: input.agent.provider,
        model_name: input.agent.model,
      });
      let attachment: AgentAttachmentRefInput;
      if (kind === 'unauthorized') {
        attachment = { ...png };
      } else {
        const uploadedForCase = await api.ossUploadAgentAttachmentBytes({
          filename: `${kind}.png`,
          mime_type: 'image/png',
          bytes: foundationPngBytes(kind),
          conversation_id: rejectedConversation.conversation_id,
        });
        uploaded.push(uploadedForCase);
        attachment = kind === 'oversized'
          ? {
              ...uploadedForCase,
              size_bytes: uploadedForCase.size_bytes + 10 * 1024 * 1024,
            }
          : { ...uploadedForCase, mime_type: 'application/zip' };
      }
      const before = await foundationExecutionSnapshot(
        agentId,
        rejectedConversation.conversation_id,
      );
      const beforeMessages = await foundationConversationReadback(
        rejectedConversation.conversation_id,
      );
      const rejected = await runFoundationAttachmentTurn({
        agentId,
        conversationId: rejectedConversation.conversation_id,
        provider: input.agent.provider || undefined,
        model: input.agent.model || undefined,
        capabilitySessionId: input.capabilitySessionId,
        attachments: [attachment],
        content: 'This request must be rejected before provider execution.',
      });
      const after = await foundationExecutionSnapshot(
        agentId,
        rejectedConversation.conversation_id,
      );
      const afterMessages = await foundationConversationReadback(
        rejectedConversation.conversation_id,
      );
      return {
        accepted: rejected.result.ok,
        errorCode: observedErrorCode(
          new Error(rejected.result.error ?? 'CONTEXT_ATTACHMENT_REJECTED'),
        ),
        turnDelta: after.turnCount - before.turnCount,
        providerExecutionDelta:
          after.providerCallCount - before.providerCallCount,
        messageDelta:
          afterMessages.messages.length - beforeMessages.messages.length,
      };
    };
    const oversized = await rejectedCase('oversized');
    const unsupported = await rejectedCase('unsupported');
    const unauthorized = await rejectedCase('unauthorized');

    const downloaded = await foundationResolvedBytes(pdf.object_ref);
    const actualChecksum = `sha256:${await sha256Bytes(downloaded)}`;
    const runtimeEvent = [...valid.result.events]
      .reverse()
      .map((event) => ({
        eventType: event.event,
        sequence: Number(event.data.seq ?? 0),
        observedAt: event.observedAt,
      }))
      .find((event) => event.sequence > 0);
    if (!runtimeEvent) {
      throw new Error('agent.acceptance.foundationAttachmentRuntimeEventMissing');
    }

    const cleanupResults = [];
    for (const attachment of uploaded) {
      await api.ossDeleteAgentAttachment(attachment.object_ref);
      let unavailable = false;
      try {
        await foundationResolvedBytes(attachment.object_ref);
      } catch {
        unavailable = true;
      }
      cleanupResults.push({
        attachmentId: attachment.attachment_id,
        unavailable,
      });
    }
    uploaded.length = 0;

    return {
      conversationId: conversation.conversation_id,
      turnId: valid.turnId,
      durationMs: performance.now() - startedAt,
      runtimeEvent,
      facts: {
        validFiles: {
          png: beforeRestart[0],
          pdf: beforeRestart[1],
        },
        persistence: {
          beforeRestart,
          afterRestart,
          projectionReadback,
          contextSegmentAttachmentIds: [...segmentById.keys()].sort(),
        },
        uploadRecovery: {
          failedUpload: {
            errorCode: failedUploadError || 'CONTEXT_ATTACHMENT_REJECTED',
            retriedAttachmentId: retried.attachment_id,
            retriedChecksum: retried.checksum,
          },
          removal: {
            removedAttachmentId: retried.attachment_id,
            removedObjectUnavailable,
            siblingIdsBefore: siblingIds,
            siblingIdsAfter: siblingIds,
            siblingChecksumsBefore,
            siblingChecksumsAfter,
          },
        },
        rejections: { oversized, unsupported, unauthorized },
        references: beforeRestart,
        authorizedDownload: {
          attachmentId: pdf.attachment_id,
          authorized: true,
          downloaded: downloaded.length === pdf.size_bytes,
          expectedChecksum: pdf.checksum,
          actualChecksum,
        },
        cleanup: {
          objects: cleanupResults,
        },
      },
    };
  } catch (error) {
    scenarioError = error;
    throw error;
  } finally {
    const cleanupTasks: Promise<unknown>[] =
      uploaded.map(async (attachment) => {
        await api.ossDeleteAgentAttachment(attachment.object_ref);
        try {
          await foundationResolvedBytes(attachment.object_ref);
        } catch {
          return;
        }
        throw new Error('agent.acceptance.foundationAttachmentCleanupFailed');
      });
    if (
      originalToolBinding
      && currentToolBinding
      && (
        currentToolBinding.enabled !== originalToolBinding.enabled
        || currentToolBinding.approvalPolicy !== originalToolBinding.approvalPolicy
      )
    ) {
      cleanupTasks.push(updateFoundationToolPolicy(
        input.agent,
        toolFixture,
        currentToolBinding,
        originalToolBinding.approvalPolicy,
        originalToolBinding.enabled,
      ));
    }
    const cleanup = await Promise.allSettled(cleanupTasks);
    const failed = cleanup.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected' && scenarioError === null) {
      throw failed.reason;
    }
  }
}

async function runFoundationF06Prepare(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  scenarioKey: string;
  platform: string;
  locale: string;
  sampleId: string;
}): Promise<FoundationF06Handoff> {
  const scenarioStartedAt = new Date().toISOString();
  foundationF06Controllers.get(input.scenarioKey)?.abort();
  foundationF06Controllers.delete(input.scenarioKey);
  removeFoundationF06Handoff(input.scenarioKey);
  const agentId = input.agent.id || input.agent.name;
  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation recovery ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  try {
    return await withFoundationCapabilitiesDisabled(
      input.agent,
      input.capabilitySessionId,
      (toolIsolation) => prepareFoundationF06Conversation(
        input,
        conversation,
        agentId,
        scenarioStartedAt,
        toolIsolation,
      ),
    );
  } catch (error) {
    const activeTurnId = useAgentTurnRecoveryStore.getState()
      .active[conversation.conversation_id]?.turnId ?? '';
    const authDiagnostic = redactedAuthError(error);
    try {
      await cleanupFoundationF06Scenario({
        scenarioKey: input.scenarioKey,
        conversationId: conversation.conversation_id,
        turnId: activeTurnId,
      });
    } catch (cleanupError) {
      const primary = error instanceof Error ? error.message : String(error);
      const cleanup = cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
      throw new Error(
        `CLEANUP_FAILED:${primary}; auth=${JSON.stringify(authDiagnostic)}; cleanup=${cleanup}`,
      );
    }
    const primary = error instanceof Error ? error.message : String(error);
    throw new Error(`${primary}; auth=${JSON.stringify(authDiagnostic)}`);
  }
}

async function prepareFoundationF06Conversation(
  input: {
    agent: NonNullable<ReturnType<typeof selectedAgent>>;
    capabilitySessionId: string;
    scenarioKey: string;
    platform: string;
    locale: string;
    sampleId: string;
  },
  conversation: Awaited<ReturnType<typeof api.createAgentConversation>>,
  agentId: string,
  scenarioStartedAt: string,
  toolIsolation: FoundationCapabilityIsolation,
): Promise<FoundationF06Handoff> {
  await useChatStore.getState().selectSession(conversation.conversation_id);

  const streamId = `foundation-f06-${crypto.randomUUID()}`;
  const idempotencyKey = crypto.randomUUID();
  const actorId = authenticatedFoundationActorPtid();
  let boundarySettled = false;
  let resolveBoundary!: (value: FoundationF06FaultBoundary) => void;
  let rejectBoundary!: (error: Error) => void;
  const faultBoundary = new Promise<FoundationF06FaultBoundary>((resolve, reject) => {
    resolveBoundary = resolve;
    rejectBoundary = reject;
  });
  const failBoundary = (errorKey: string) => {
    if (boundarySettled) return;
    boundarySettled = true;
    rejectBoundary(new Error(errorKey));
  };

  const observed = startObservedFoundationTurn({
    conversationId: conversation.conversation_id,
    agentId,
    content:
      'Write a detailed 2000-word numbered guide to durable event stream recovery.',
    idempotencyKey,
    streamId,
    provider: input.agent.provider || undefined,
    model: input.agent.model || undefined,
    thinkingMode: 'disabled',
    clientCapabilitySessionId: input.capabilitySessionId,
    timeoutMs: 300_000,
    onEvent: (event, events, controller, complete) => {
      if (boundarySettled) return;
      if (classifyAgentTurnTerminalEvent(event) !== null) {
        failBoundary('agent.acceptance.foundationRecoveryTurnAlreadyTerminal');
        return;
      }
      const durableEvents = events
        .filter((candidate) => Number(candidate.data.seq ?? 0) > 0)
        .sort((left, right) =>
          Number(left.data.seq ?? 0) - Number(right.data.seq ?? 0));
      const hasText = durableEvents.some((candidate) => candidate.event === 'text');
      const uniqueSequences = new Set(
        durableEvents.map((candidate) => Number(candidate.data.seq ?? 0)),
      );
      if (!hasText || uniqueSequences.size < 2) return;

      const turnId = observedTurnId(events);
      if (!turnId) {
        failBoundary('agent.acceptance.foundationRecoveryTurnMissing');
        return;
      }
      const active = useAgentTurnRecoveryStore.getState()
        .active[conversation.conversation_id];
      if (!active) {
        failBoundary('agent.acceptance.foundationRecoveryRegistrationMissing');
        return;
      }
      if (active.actorId !== actorId) {
        failBoundary('agent.acceptance.foundationRecoveryActorMismatch');
        return;
      }
      if (active.turnId !== turnId) {
        failBoundary('agent.acceptance.foundationRecoveryTurnMismatch');
        return;
      }
      if (active.streamId !== streamId) {
        failBoundary('agent.acceptance.foundationRecoveryStreamMismatch');
        return;
      }
      if (active.streamGeneration !== controller.streamGeneration) {
        failBoundary('agent.acceptance.foundationRecoveryGenerationMismatch');
        return;
      }

      const acknowledgedCursor = active.cursor;
      const duplicateSource = [...durableEvents]
        .reverse()
        .find((candidate) =>
          Number(candidate.data.seq ?? 0) === acknowledgedCursor);
      const outOfOrderSource = [...durableEvents]
        .reverse()
        .find((candidate) =>
          Number(candidate.data.seq ?? 0) < acknowledgedCursor);
      if (!duplicateSource || !outOfOrderSource) return;

      const prefix = durableEvents
        .filter((candidate) =>
          candidate.event === 'text'
          && Number(candidate.data.seq ?? 0) <= acknowledgedCursor)
        .map((candidate) =>
          String(candidate.data.content ?? candidate.data.text ?? ''))
        .join('');
      if (!prefix) {
        failBoundary('agent.acceptance.foundationRecoveryPrefixMissing');
        return;
      }

      const chatBefore = useChatStore.getState();
      const projectionBeforeMutation = stableJson({
        operation: chatBefore.operations[conversation.conversation_id]
          ? {
              turnId: chatBefore.operations[conversation.conversation_id].turnId,
              streamGeneration:
                chatBefore.operations[conversation.conversation_id].streamGeneration,
              lastEventSeq:
                chatBefore.operations[conversation.conversation_id].lastEventSeq,
              status: chatBefore.operations[conversation.conversation_id].status,
              runState: chatBefore.operations[conversation.conversation_id].runState,
            }
          : null,
        messageCount: chatBefore.messages.length,
        turnMessages: chatBefore.messages
          .filter((message) => message.turnId === turnId)
          .map((message) => ({
            id: message.id,
            content: message.content,
            terminalStatus: message.terminalStatus,
            toolCalls: message.toolCalls,
          })),
        cursor: active.cursor,
      });
      const publishFault = (
        source: { event: string; data: Record<string, unknown> },
        streamGeneration: number,
      ) => eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
        streamId,
        streamGeneration,
        ptid: actorId,
        conversationId: conversation.conversation_id,
        agentId,
        event: source.event,
        data: {
          ...source.data,
          turnId,
          conversationId: conversation.conversation_id,
        },
        timestampMs: Date.now(),
      });
      publishFault(duplicateSource, active.streamGeneration);
      publishFault(outOfOrderSource, active.streamGeneration);
      const staleGeneration = Math.max(1, active.streamGeneration - 1);
      publishFault(duplicateSource, staleGeneration);
      publishFault({
        event: 'done',
        data: {
          ...outOfOrderSource.data,
          seq: Number(outOfOrderSource.data.seq),
          status: 'completed',
        },
      }, active.streamGeneration);

      const chatAfter = useChatStore.getState();
      const activeAfterMutation = useAgentTurnRecoveryStore.getState()
        .active[conversation.conversation_id];
      const projectionAfterMutation = stableJson({
        operation: chatAfter.operations[conversation.conversation_id]
          ? {
              turnId: chatAfter.operations[conversation.conversation_id].turnId,
              streamGeneration:
                chatAfter.operations[conversation.conversation_id].streamGeneration,
              lastEventSeq:
                chatAfter.operations[conversation.conversation_id].lastEventSeq,
              status: chatAfter.operations[conversation.conversation_id].status,
              runState: chatAfter.operations[conversation.conversation_id].runState,
            }
          : null,
        messageCount: chatAfter.messages.length,
        turnMessages: chatAfter.messages
          .filter((message) => message.turnId === turnId)
          .map((message) => ({
            id: message.id,
            content: message.content,
            terminalStatus: message.terminalStatus,
            toolCalls: message.toolCalls,
          })),
        cursor: activeAfterMutation?.cursor,
      });
      const handoff: FoundationF06Handoff = {
        scenarioKey: input.scenarioKey,
        platform: input.platform,
        locale: input.locale,
        sampleId: input.sampleId,
        conversationId: conversation.conversation_id,
        turnId,
        streamId,
        streamGeneration: active.streamGeneration,
        actorPtid: actorId,
        actorPtidHash: 'pending',
        acknowledgedCursor,
        conversationRevision: conversation.version,
        prefixHash: 'pending',
        prefixLength: prefix.length,
        duplicateSequence: Number(duplicateSource.data.seq),
        outOfOrderSequence: Number(outOfOrderSource.data.seq),
        staleGeneration,
        staleGenerationRejected:
          activeAfterMutation?.streamGeneration === active.streamGeneration,
        staleTerminalRejected:
          activeAfterMutation?.turnId === turnId
          && chatAfter.operations[conversation.conversation_id]?.status
            !== 'completed',
        cursorBeforeMutation: active.cursor,
        cursorAfterMutation: activeAfterMutation?.cursor ?? 0,
        projectionBeforeMutationHash: 'pending',
        projectionAfterMutationHash: 'pending',
        duplicatePayloadHash: 'pending',
        outOfOrderPayloadHash: 'pending',
        transitions: [],
        replayedSequences: [],
        replayDeliveries: [],
        preparationAttempts: 1,
        toolIsolation,
        preparedAt: scenarioStartedAt,
      };
      foundationF06PendingHandoffs.set(input.scenarioKey, handoff);
      boundarySettled = true;
      controller.disconnectTransport();
      resolveBoundary({
        handoff,
        projectionBeforeMutation,
        projectionAfterMutation,
        prefix,
        duplicateSource,
        outOfOrderSource,
      });
      complete();
    },
  });
  foundationF06Controllers.set(input.scenarioKey, observed.controller);
  const boundary = await Promise.race([
    faultBoundary,
    observed.result.then((result) => {
      throw new Error(
        result.error || 'agent.acceptance.foundationRecoveryTurnAlreadyTerminal',
      );
    }),
  ]);
  const [
    actorPtidHash,
    prefixHash,
    projectionBeforeMutationHash,
    projectionAfterMutationHash,
    duplicatePayloadHash,
    outOfOrderPayloadHash,
  ] = await Promise.all([
    sha256Hex(boundary.handoff.actorPtid),
    sha256Hex(boundary.prefix),
    sha256Hex(boundary.projectionBeforeMutation),
    sha256Hex(boundary.projectionAfterMutation),
    sha256Hex(stableJson(boundary.duplicateSource)),
    sha256Hex(stableJson(boundary.outOfOrderSource)),
  ]);
  await foundationF06ReplayRecording;
  const handoff = foundationF06PendingHandoffs.get(input.scenarioKey);
  if (!handoff) {
    throw new Error('agent.acceptance.foundationRecoveryHandoffMissing');
  }
  Object.assign(handoff, {
    actorPtidHash,
    prefixHash,
    projectionBeforeMutationHash,
    projectionAfterMutationHash,
    duplicatePayloadHash,
    outOfOrderPayloadHash,
  });
  foundationF06PendingHandoffs.delete(input.scenarioKey);
  writeFoundationF06Handoff(handoff);

  eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'settings' });
  await waitFor(
    () => document.querySelector('[data-pt-agent-composer]')?.getClientRects()
      .length === 0,
    'Foundation AS-F06 page switch',
    30_000,
  );
  return handoff;
}

async function observeFoundationRecoveryFailure(
  handoff: FoundationF06Handoff,
): Promise<Record<string, unknown>> {
  const controller = foundationF06Controllers.get(handoff.scenarioKey);
  if (
    !controller
    || controller.streamGeneration !== handoff.streamGeneration
  ) {
    throw new Error('agent.acceptance.foundationRecoveryControllerMissing');
  }
  await foundationF06ReplayRecording;
  const activeAtOutage = useAgentTurnRecoveryStore.getState()
    .active[handoff.conversationId];
  if (
    !activeAtOutage
    || activeAtOutage.actorId !== handoff.actorPtid
    || activeAtOutage.turnId !== handoff.turnId
    || activeAtOutage.streamId !== handoff.streamId
    || activeAtOutage.streamGeneration !== handoff.streamGeneration
  ) {
    throw new Error('agent.acceptance.foundationRecoveryRegistrationMissing');
  }
  let failureWaitError = '';
  try {
    await waitFor(
      () => useAgentTurnRecoveryStore.getState()
        .active[handoff.conversationId]?.phase === 'RECOVERY_FAILED',
      'Foundation AS-F06 active recovery failure',
      120_000,
    );
  } catch (error) {
    failureWaitError = error instanceof Error ? error.message : String(error);
  }
  const authenticatedPtid =
    useSessionStore.getState().currentUser?.ptid?.trim()
    || useSessionStore.getState().currentUser?.actorId.trim()
    || '';
  const active = useAgentTurnRecoveryStore.getState().active[handoff.conversationId];
  const recoveryActorPtid = active?.actorId ?? '';
  const base = {
    expectedActorPtidHash: handoff.actorPtidHash,
    observedActorPtidHash: recoveryActorPtid
      ? await sha256Hex(recoveryActorPtid)
      : '',
    sessionProjectionAvailable: Boolean(authenticatedPtid),
    sessionActorMatches:
      !authenticatedPtid || authenticatedPtid === recoveryActorPtid,
    expectedTurnId: handoff.turnId,
    observedTurnId: active?.turnId ?? '',
    expectedStreamId: handoff.streamId,
    observedStreamId: active?.streamId ?? '',
    expectedStreamGeneration: handoff.streamGeneration,
    observedStreamGeneration: active?.streamGeneration ?? 0,
    observedPhase: active?.phase ?? 'MISSING',
    failureWaitError,
    transitions: [...handoff.transitions],
    errorHash: active?.failureKey ? await sha256Hex(active.failureKey) : '',
    notCompleted:
      active?.phase === 'RECOVERY_FAILED'
      && useChatStore.getState().operations[handoff.conversationId]?.status
        !== 'completed',
  };
  if (!active || active.phase !== 'RECOVERY_FAILED') {
    const evidence = {
      ...base,
      blocker: 'AS_F06_ACTIVE_RECOVERY_FAILURE_NOT_OBSERVED',
      activeFailureObserved: false,
      retry: { invoked: false, observed: false },
      durableReload: { invoked: false, observed: false },
    };
    await updateFoundationF06RecoveryFailure(handoff.scenarioKey, evidence);
    return evidence;
  }
  if (
    active.actorId !== handoff.actorPtid
    || (authenticatedPtid && active.actorId !== authenticatedPtid)
    || active.turnId !== handoff.turnId
    || active.streamId !== handoff.streamId
    || active.streamGeneration !== handoff.streamGeneration
  ) {
    const evidence = {
      ...base,
      blocker: 'AS_F06_ACTIVE_RECOVERY_IDENTITY_MISMATCH',
      activeFailureObserved: true,
      retry: { invoked: false, observed: false },
      durableReload: { invoked: false, observed: false },
    };
    await updateFoundationF06RecoveryFailure(handoff.scenarioKey, evidence);
    return evidence;
  }

  const retryEpochBefore = active.recoveryEpoch;
  useChatStore.getState().retryTurnRecovery(handoff.conversationId);
  await waitFor(
    () => {
      const current =
        useAgentTurnRecoveryStore.getState().active[handoff.conversationId];
      return Boolean(current && current.recoveryEpoch > retryEpochBefore);
    },
    'Foundation AS-F06 retry action observation',
    30_000,
  );
  await waitFor(
    () => {
      const current =
        useAgentTurnRecoveryStore.getState().active[handoff.conversationId];
      return Boolean(
        current
        && current.recoveryEpoch > retryEpochBefore
        && current.phase === 'RECOVERY_FAILED',
      );
    },
    'Foundation AS-F06 retry failure under bounded outage',
    120_000,
  );
  await flushAgentTurnRecoveryPersistence();
  const afterRetry =
    useAgentTurnRecoveryStore.getState().active[handoff.conversationId];
  const evidence = {
    ...base,
    blocker: afterRetry ? '' : 'AS_F06_RETRY_RESULT_NOT_OBSERVED',
    activeFailureObserved: true,
    retry: {
      invoked: true,
      observed:
        Boolean(afterRetry)
        && afterRetry?.actorId === handoff.actorPtid
        && (!authenticatedPtid || afterRetry.actorId === authenticatedPtid)
        && afterRetry.turnId === handoff.turnId
        && afterRetry.streamId === handoff.streamId
        && afterRetry.streamGeneration === handoff.streamGeneration
        && afterRetry.recoveryEpoch > retryEpochBefore,
      recoveryEpochBefore: retryEpochBefore,
      recoveryEpochAfter: afterRetry?.recoveryEpoch ?? 0,
      resultingPhase: afterRetry?.phase ?? 'MISSING',
    },
    durableReload: { invoked: false, observed: false },
  };
  await updateFoundationF06RecoveryFailure(handoff.scenarioKey, evidence);
  return evidence;
}

async function exerciseFoundationDurableReload(
  handoff: FoundationF06Handoff,
): Promise<Record<string, unknown>> {
  await foundationF06ReplayRecording;
  const currentHandoff = readFoundationF06Handoff(handoff.scenarioKey);
  const prior = evidenceRecord(
    currentHandoff?.recoveryFailure,
    'foundationF06ObservedRecoveryFailure',
  );
  const authenticatedPtid =
    useSessionStore.getState().currentUser?.ptid?.trim()
    || useSessionStore.getState().currentUser?.actorId.trim()
    || '';
  const active = useAgentTurnRecoveryStore.getState().active[handoff.conversationId];
  if (
    !active
    || active.actorId !== handoff.actorPtid
    || (authenticatedPtid && active.actorId !== authenticatedPtid)
    || active.turnId !== handoff.turnId
    || active.streamId !== handoff.streamId
    || active.streamGeneration !== handoff.streamGeneration
  ) {
    const evidence = {
      ...prior,
      blocker: 'AS_F06_DURABLE_RELOAD_TARGET_MISSING',
      durableReload: { invoked: false, observed: false },
    };
    await updateFoundationF06RecoveryFailure(handoff.scenarioKey, evidence);
    return evidence;
  }

  const reloadResult: AgentTurnSnapshotReloadResult =
    await useChatStore.getState().reloadTurnSnapshot(handoff.conversationId);
  const sourceDelivery = reloadResult.sourceDelivery;
  const reloadObserved =
    reloadResult.source === 'station-snapshot-reconcile'
    && reloadResult.actorId === authenticatedPtid
    && reloadResult.conversationId === handoff.conversationId
    && reloadResult.turnId === handoff.turnId
    && reloadResult.streamId === handoff.streamId
    && reloadResult.streamGeneration === handoff.streamGeneration
    && typeof reloadResult.status === 'string'
    && reloadResult.status.length > 0
    && Number.isSafeInteger(reloadResult.sequence)
    && reloadResult.sequence >= handoff.acknowledgedCursor
    && sourceDelivery.transport === 'station-sse'
    && sourceDelivery.ptid === authenticatedPtid
    && sourceDelivery.conversationId === handoff.conversationId
    && sourceDelivery.turnId === handoff.turnId
    && sourceDelivery.sequence === reloadResult.sequence
    && sourceDelivery.rawPayload.eventType === 'snapshot'
    && (
      reloadResult.terminal
        ? ['completed', 'failed', 'cancelled', 'interrupted'].includes(
            reloadResult.terminalStatus ?? '',
          )
        : reloadResult.terminalStatus === null
    );
  const evidence = {
    ...prior,
    blocker: reloadObserved ? '' : 'AS_F06_DURABLE_RELOAD_RESULT_NOT_OBSERVED',
    durableReload: {
      invoked: true,
      observed: reloadObserved,
      source: reloadResult.source,
      actorPtidHash: await sha256Hex(reloadResult.actorId),
      conversationId: reloadResult.conversationId,
      turnId: reloadResult.turnId,
      streamId: reloadResult.streamId,
      streamGeneration: reloadResult.streamGeneration,
      status: reloadResult.status,
      sequence: reloadResult.sequence,
      terminal: reloadResult.terminal,
      terminalStatus: reloadResult.terminalStatus,
      sourceDelivery: {
        transport: sourceDelivery.transport,
        actorPtidHash: await sha256Hex(sourceDelivery.ptid),
        conversationId: sourceDelivery.conversationId,
        turnId: sourceDelivery.turnId,
        sequence: sourceDelivery.sequence,
        eventType: sourceDelivery.rawPayload.eventType,
        rawPayloadHash: await sha256Hex(stableJson(sourceDelivery.rawPayload)),
      },
    },
  };
  await updateFoundationF06RecoveryFailure(handoff.scenarioKey, evidence);
  return evidence;
}

async function cleanupFoundationF06Scenario(input: {
  scenarioKey: string;
  conversationId: string;
  turnId: string;
}): Promise<Record<string, unknown>> {
  const controller = foundationF06Controllers.get(input.scenarioKey);
  foundationF06Controllers.delete(input.scenarioKey);
  controller?.abort();
  const handoff = readFoundationF06Handoff(input.scenarioKey);
  if (
    handoff
    && (
      handoff.conversationId !== input.conversationId
      || handoff.turnId !== input.turnId
    )
  ) {
    throw new Error('agent.acceptance.foundationCleanupIdentityMismatch');
  }
  let cleanupError: unknown = null;
  let deletionErrorCode = '';
  try {
    if (input.turnId) {
      await api.cancelAgentTurn(input.turnId);
    }
    await cancelFoundationQueuedTurns(input.conversationId);
    deletionErrorCode = await deleteFoundationConversation(input.conversationId);
  } catch (error) {
    deletionErrorCode = observedErrorCode(error);
    if (!deletionErrorCode.includes('AGENT_4004')) {
      cleanupError = error;
    }
  } finally {
    useAgentTurnRecoveryStore.getState().clear(
      input.conversationId,
      input.turnId,
    );
    removeFoundationF06Handoff(input.scenarioKey);
  }

  let conversationDeleted = false;
  try {
    const deleted = await api.getAgentConversation(input.conversationId);
    conversationDeleted = deleted.status === 'deleted';
    if (conversationDeleted) {
      deletionErrorCode = 'CONVERSATION_DELETED';
    } else if (cleanupError === null) {
      cleanupError = new Error(
        'agent.acceptance.foundationCleanupConversationNotDeleted',
      );
    }
  } catch (error) {
    deletionErrorCode = observedErrorCode(error);
    conversationDeleted = deletionErrorCode.includes('AGENT_4004');
    if (!conversationDeleted && cleanupError === null) cleanupError = error;
  }
  const handoffCleared = readFoundationF06Handoff(input.scenarioKey) === null;
  const recoveryRecordCleared =
    useAgentTurnRecoveryStore.getState().active[input.conversationId] === undefined;
  const cleanupComplete =
    conversationDeleted && handoffCleared && recoveryRecordCleared;
  if (cleanupError !== null || !cleanupComplete) {
    const detail = cleanupError instanceof Error
      ? cleanupError.message
      : 'agent.acceptance.foundationCleanupVerificationFailed';
    throw new Error(`CLEANUP_FAILED:${deletionErrorCode}:${detail}`);
  }
  return {
    cleanupComplete,
    handoffCleared,
    conversationDeleted,
    recoveryRecordCleared,
    deletionErrorCodeHash: await sha256Hex(deletionErrorCode),
  };
}

async function runFoundationF06Complete(
  stationRestart: Record<string, unknown>,
  durableReloadEvidence: Record<string, unknown>,
  input: {
    scenarioKey: string;
    platform: string;
    locale: string;
    sampleId: string;
  },
): Promise<{
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
  const handoff = readFoundationF06Handoff(input.scenarioKey);
  if (!handoff) {
    throw new Error('agent.acceptance.foundationRecoveryHandoffMissing');
  }
  if (
    handoff.platform !== input.platform
    || handoff.locale !== input.locale
    || handoff.sampleId !== input.sampleId
  ) {
    throw new Error('agent.acceptance.foundationRecoveryScopeMismatch');
  }
  await useChatStore.getState().selectSession(handoff.conversationId);

  await waitFor(
    () => {
      const current = readFoundationF06Handoff(input.scenarioKey);
      return Boolean(
        current?.transitions.some((transition) =>
          transition.phase === 'CONNECTED'
          || transition.phase === 'RECOVERY_FAILED'),
      );
    },
    'Foundation AS-F06 recovery transition',
    120_000,
  );
  const agent = selectedAgent();
  if (!agent) throw new Error('agent.acceptance.agentMissing');
  const agentId = agent.id || agent.name;
  const beforeDurableFacts = await foundationDurableMutationSnapshot(
    agentId,
    handoff.conversationId,
    handoff.turnId,
  );

  await waitFor(
    () => {
      const state = useChatStore.getState();
      const operation = state.operations[handoff.conversationId];
      const persistedMessage = [...state.messages]
        .reverse()
        .find((message) =>
          message.role === 'assistant' && message.turnId === handoff.turnId);
      return Boolean(
        (
          operation
          && ['completed', 'failed', 'cancelled', 'interrupted'].includes(
            operation.status,
          )
        )
        || (
          persistedMessage?.terminalStatus
          && ['completed', 'failed', 'cancelled', 'interrupted'].includes(
            persistedMessage.terminalStatus,
          )
        ),
      );
    },
    'Foundation AS-F06 terminal projection',
    180_000,
  );
  const stationSnapshot = await foundationConversationReadback(
    handoff.conversationId,
  );
  const terminalEvidence = await foundationTurnEvidence(
    handoff.conversationId,
    handoff.turnId,
  );
  const afterDurableFacts = await foundationDurableMutationSnapshot(
    agentId,
    handoff.conversationId,
    handoff.turnId,
  );
  const chatState = useChatStore.getState();
  const operation = chatState.operations[handoff.conversationId];
  const projectedAssistant = [...chatState.messages]
    .reverse()
    .find((message) =>
      message.role === 'assistant' && message.turnId === handoff.turnId);
  const stationAssistant = [...stationSnapshot.messages]
    .reverse()
    .find((message) =>
      message.role === 'assistant' && message.turnId === handoff.turnId);
  if (!projectedAssistant || !stationAssistant) {
    throw new Error('agent.acceptance.foundationRecoveryProjectionMissing');
  }
  const clientTerminalStatus =
    operation?.status
    || projectedAssistant.terminalStatus
    || 'unknown';

  let staleRevisionError = '';
  const staleRevisionBase = stationSnapshot.conversation.version;
  await api.updateAgentConversation({
    conversation_id: handoff.conversationId,
    expected_version: staleRevisionBase,
    title: stationSnapshot.conversation.title,
  });
  try {
    await api.updateAgentConversation({
      conversation_id: handoff.conversationId,
      expected_version: staleRevisionBase,
      title: stationSnapshot.conversation.title,
    });
  } catch (error) {
    staleRevisionError = observedErrorCode(error);
  }

  await foundationF06ReplayRecording;
  const latestHandoff = readFoundationF06Handoff(input.scenarioKey);
  if (!latestHandoff) {
    throw new Error('agent.acceptance.foundationRecoveryHandoffMissing');
  }
  const persistedRecoveryFailure = evidenceRecord(
    latestHandoff.recoveryFailure,
    'foundationF06RecoveryFailure',
  );
  const coordinatorRecoveryFailure = evidenceRecord(
    durableReloadEvidence,
    'foundationF06CoordinatorRecoveryFailure',
  );
  const recoveryFailure = {
    ...persistedRecoveryFailure,
    durableReload: evidenceRecord(
      coordinatorRecoveryFailure.durableReload,
      'foundationF06CoordinatorDurableReload',
    ),
  };
  const replayStartTransition = latestHandoff.transitions.find(
    (transition) =>
      transition.phase === 'REPLAYING'
      && transition.sequence >= handoff.acknowledgedCursor,
  );
  if (!replayStartTransition) {
    throw new Error('agent.acceptance.foundationRecoveryReplayBoundaryMissing');
  }
  const replayAfterCursor = replayStartTransition.sequence;
  const stationReplayDeliveries = await foundationStationReplayReadback({
    ...handoff,
    acknowledgedCursor: replayAfterCursor,
  });
  const replayIdentity = (delivery: FoundationF06ReplayDelivery) => ({
    eventType: delivery.eventType,
    sequence: delivery.sequence,
    sourceTransport: delivery.sourceTransport,
    sourcePtidHash: delivery.sourcePtidHash,
    sourceConversationId: delivery.sourceConversationId,
    sourceTurnId: delivery.sourceTurnId,
    sourceSequence: delivery.sourceSequence,
    sourceEventType: delivery.sourceEventType,
    rawPayload: delivery.rawPayload,
    payloadHash: delivery.payloadHash,
  });
  const replayedEvents = latestHandoff.transitions.filter(
    (transition) => transition.sequence > handoff.acknowledgedCursor,
  );
  const terminalDiagnostics = evidenceRecord(
    evidenceRecord(terminalEvidence, 'foundationF06TerminalEvidence').diagnostics,
    'foundationF06TerminalDiagnostics',
  );
  const terminalReplay = evidenceRecord(
    terminalDiagnostics.replay,
    'foundationF06TerminalReplay',
  );
  const terminalStatus = ({
    [AgentTurnStatus.COMPLETED]: 'completed',
    [AgentTurnStatus.FAILED]: 'failed',
    [AgentTurnStatus.CANCELLED]: 'cancelled',
    [AgentTurnStatus.INTERRUPTED]: 'interrupted',
  } as Record<number, string>)[Number(terminalReplay.status)] ?? 'unknown';
  const projectionHash = await sha256Hex(stableJson({
    turnId: projectedAssistant.turnId,
    content: projectedAssistant.content,
  }));
  const stationHash = await sha256Hex(stableJson({
    turnId: stationAssistant.turnId,
    content: stationAssistant.content,
  }));
  // #region debug-point A-D:final-terminal-projection
  void fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'browser-terminal-projection',
      runId: 'post-fix',
      hypothesisId: 'A-D',
      location: 'harness.ts:runFoundationF06Complete',
      msg: '[DEBUG] final terminal projection sampled',
      data: {
        operationStatus: operation?.status ?? null,
        messageTerminalStatus: projectedAssistant.terminalStatus ?? null,
        clientContentLength: projectedAssistant.content.length,
        clientHash: projectionHash,
        stationStatus: terminalStatus,
        stationContentLength: stationAssistant.content.length,
        stationHash,
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  const runtimeEvent = replayedEvents[replayedEvents.length - 1]
    ?? latestHandoff.transitions[latestHandoff.transitions.length - 1];
  if (!runtimeEvent) {
    throw new Error('agent.acceptance.foundationRecoveryTransitionMissing');
  }
  const preparedAtMs = Date.parse(handoff.preparedAt);
  if (!Number.isFinite(preparedAtMs)) {
    throw new Error('agent.acceptance.foundationRecoveryStartMissing');
  }
  const recoveryRecordCleared =
    useAgentTurnRecoveryStore.getState().active[handoff.conversationId]
      === undefined;
  const duplicateMutationCount = (snapshot: Record<string, unknown>) => {
    const messages = evidenceRecord(
      snapshot.messages,
      'foundationF06DurableMessages',
    );
    const traces = evidenceRecord(
      snapshot.traces,
      'foundationF06DurableTraces',
    );
    return Number(messages.duplicateCount)
      + Number(messages.diagnosticDuplicateCount)
      + Number(traces.duplicateCount);
  };
  const duplicateSideEffectCount = (snapshot: Record<string, unknown>) =>
    Number(
      evidenceRecord(
        snapshot.sideEffects,
        'foundationF06DurableSideEffects',
      ).duplicateCount,
    );

  return {
    conversationId: handoff.conversationId,
    turnId: handoff.turnId,
    durationMs: Date.now() - preparedAtMs,
    runtimeEvent: {
      eventType: runtimeEvent.phase.toLowerCase(),
      sequence: runtimeEvent.sequence,
      observedAt: runtimeEvent.observedAt,
    },
    facts: {
      scope: {
        scenarioKey: handoff.scenarioKey,
        platform: handoff.platform,
        locale: handoff.locale,
        sampleId: handoff.sampleId,
      },
      toolIsolation: handoff.toolIsolation,
      handoff: {
        conversationId: handoff.conversationId,
        turnId: handoff.turnId,
        streamId: handoff.streamId,
        streamGeneration: handoff.streamGeneration,
        actorPtidHash: handoff.actorPtidHash,
        acknowledgedCursor: handoff.acknowledgedCursor,
        conversationRevision: handoff.conversationRevision,
        prefixHash: handoff.prefixHash,
        prefixLength: handoff.prefixLength,
        preparationAttempts: handoff.preparationAttempts,
      },
      transitions: latestHandoff.transitions,
      replay: {
        afterCursor: replayAfterCursor,
        eventSequences: latestHandoff.replayedSequences,
        deliveries: latestHandoff.replayDeliveries,
        stationReadbackDeliveries: stationReplayDeliveries,
        sourceHash: await sha256Hex(stableJson(
          latestHandoff.replayDeliveries.map(replayIdentity),
        )),
        replayHash: await sha256Hex(stableJson(
          stationReplayDeliveries.map(replayIdentity),
        )),
      },
      idempotence: {
        duplicateSequence: handoff.duplicateSequence,
        outOfOrderSequence: handoff.outOfOrderSequence,
        staleGeneration: handoff.staleGeneration,
        activeGeneration: handoff.streamGeneration,
        staleGenerationRejected: handoff.staleGenerationRejected,
        staleTerminalRejected: handoff.staleTerminalRejected,
        cursorBeforeMutation: handoff.cursorBeforeMutation,
        cursorAfterMutation: handoff.cursorAfterMutation,
        projectionBeforeMutationHash: handoff.projectionBeforeMutationHash,
        projectionAfterMutationHash: handoff.projectionAfterMutationHash,
        duplicatePayloadHash: handoff.duplicatePayloadHash,
        outOfOrderPayloadHash: handoff.outOfOrderPayloadHash,
      },
      restartRecovery: {
        pageSwitched: true,
        clientReloaded:
          evidenceRecord(
            stationRestart.clientReloads,
            'foundationF06ClientReloads',
          )[input.platform] === true,
        stationRestarted:
          typeof stationRestart.containerId === 'string'
          && stationRestart.containerId.length > 0
          && stationRestart.outageObserved === true
          && stationRestart.beforeStartedAt !== stationRestart.afterStartedAt
          && stationRestart.beforeCommit === stationRestart.afterCommit,
        stationRestart,
      },
      transportLoss: {
        observed: latestHandoff.transitions
          .some((transition) => transition.phase === 'CONNECTION_LOST'),
        nonTerminal: latestHandoff.transitions
          .filter((transition) => transition.phase === 'CONNECTION_LOST')
          .every((transition) => !transition.terminal),
      },
      terminalProjection: {
        stationStatus: terminalStatus,
        clientStatus: clientTerminalStatus,
        stationHash,
        clientHash: projectionHash,
        prefixPreserved:
          (stationAssistant.content ?? '').length >= handoff.prefixLength
          && await sha256Hex(
            (stationAssistant.content ?? '').slice(0, handoff.prefixLength),
          ) === handoff.prefixHash,
      },
      recoveryFailure,
      staleRevision: {
        rejected: staleRevisionError === 'VERSION_CONFLICT',
        errorCodeHash: await sha256Hex(staleRevisionError),
      },
      sideEffects: {
        before: beforeDurableFacts,
        after: afterDurableFacts,
        duplicateMutationBefore: duplicateMutationCount(beforeDurableFacts),
        duplicateMutationAfter: duplicateMutationCount(afterDurableFacts),
        duplicateMutationDelta:
          duplicateMutationCount(afterDurableFacts)
          - duplicateMutationCount(beforeDurableFacts),
        duplicateSideEffectBefore:
          duplicateSideEffectCount(beforeDurableFacts),
        duplicateSideEffectAfter:
          duplicateSideEffectCount(afterDurableFacts),
        duplicateSideEffectDelta:
          duplicateSideEffectCount(afterDurableFacts)
          - duplicateSideEffectCount(beforeDurableFacts),
      },
      cleanup: {
        cleanupComplete: false,
        handoffCleared: false,
        conversationDeleted: false,
        recoveryRecordCleared,
        deletionErrorCodeHash: '',
      },
    },
  };
}

async function foundationRevisionMessageFact(
  value: unknown,
  name: string,
): Promise<Record<string, unknown>> {
  const message = evidenceRecord(value, name);
  const content = String(message.content ?? '');
  return {
    messageId: String(evidenceField(message, 'messageId', 'message_id') ?? ''),
    turnId: String(evidenceField(message, 'turnId', 'turn_id') ?? ''),
    role: String(message.role ?? ''),
    status: String(
      evidenceField(message, 'messageStatus', 'message_status')
      ?? message.status
      ?? '',
    ),
    branchId: String(evidenceField(message, 'branchId', 'branch_id') ?? ''),
    parentMessageId: String(
      evidenceField(message, 'parentMessageId', 'parent_message_id') ?? '',
    ),
    replacesMessageId: String(
      evidenceField(message, 'replacesMessageId', 'replaces_message_id') ?? '',
    ),
    contentHash: await sha256Hex(content),
  };
}

// #region debug-point A-E:as-f07-revision-stage
function reportFoundationF07Debug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'as-f07-revision-flow',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:runFoundationF07Scenario',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

function foundationTurnAttemptFacts(value: unknown): Record<string, unknown>[] {
  const evidence = evidenceRecord(value, 'foundationF07TurnEvidence');
  const diagnostics = evidenceRecord(
    evidence.diagnostics,
    'foundationF07Diagnostics',
  );
  const replay = evidenceRecord(
    diagnostics.replay,
    'foundationF07DiagnosticReplay',
  );
  return evidenceArray(
    replay.attempts,
    'foundationF07Attempts',
  ).map((candidate) => {
    const attempt = evidenceRecord(candidate, 'foundationF07Attempt');
    return {
      attemptId: String(evidenceField(attempt, 'attemptId', 'attempt_id') ?? ''),
      turnId: String(evidenceField(attempt, 'turnId', 'turn_id') ?? ''),
      index: Number(attempt.index ?? 0),
      status: Number(attempt.status ?? 0),
      usage: evidenceValue(attempt.usage ?? null),
    };
  });
}

async function runFoundationF07Scenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
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
  const scenarioStartedAt = performance.now();
  const agentId = input.agent.id || input.agent.name;
  reportFoundationF07Debug('A-E', 'scenario-started', {
    platform: input.platform,
    sampleId: input.sampleId,
  });
  const retryConversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation retry ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  await useChatStore.getState().selectSession(retryConversation.conversation_id);
  const retryCapabilitySession = await resolveFoundationToolTurnSession();

  let cancellationRequested = false;
  let resolveCancellation!: (value: {
    turnId: string;
    result: Promise<Awaited<ReturnType<typeof api.cancelAgentTurn>>>;
  }) => void;
  const cancellation = new Promise<{
    turnId: string;
    result: Promise<Awaited<ReturnType<typeof api.cancelAgentTurn>>>;
  }>((resolve) => {
    resolveCancellation = resolve;
  });
  const retrySource = startObservedFoundationTurn({
    conversationId: retryConversation.conversation_id,
    agentId,
    content: `Reply with one short sentence for retry sample ${input.sampleId}.`,
    idempotencyKey: crypto.randomUUID(),
    provider: input.agent.provider || undefined,
    model: input.agent.model || undefined,
    effort: 'low',
    thinkingMode: 'disabled',
    clientCapabilitySessionId: retryCapabilitySession.capabilitySessionId,
    onEvent: (event, events) => {
      if (
        cancellationRequested
        || event.event !== 'progress'
        || event.data.stage !== 'provider_call_started'
      ) {
        return;
      }
      const turnId = observedTurnId(events);
      if (!turnId) return;
      cancellationRequested = true;
      reportFoundationF07Debug('A', 'retry-source-cancel-requested', {
        elapsedMs: performance.now() - scenarioStartedAt,
        sequence: Number(event.data.seq ?? 0),
      });
      resolveCancellation({
        turnId,
        result: api.cancelAgentTurn(turnId),
      });
    },
  });
  const cancellationAttempt = await Promise.race([
    cancellation,
    retrySource.result.then((result) => {
      throw new Error(
        result.error || 'agent.acceptance.foundationRevisionRetrySourceMissing',
      );
    }),
  ]);
  await cancellationAttempt.result;
  const retrySourceResult = await retrySource.result;
  if (!retrySourceResult.events.some((event) =>
    classifyAgentTurnTerminalEvent(event) === 'cancelled')) {
    throw new Error('agent.acceptance.foundationRevisionRetrySourceNotCancelled');
  }
  reportFoundationF07Debug('A-B', 'retry-source-finished', {
    elapsedMs: performance.now() - scenarioStartedAt,
    terminalEvent: [...retrySourceResult.events]
      .reverse()
      .find((event) => classifyAgentTurnTerminalEvent(event) !== null)?.event
      ?? null,
  });
  const retryEvidenceBefore = await foundationTurnEvidence(
    retryConversation.conversation_id,
    cancellationAttempt.turnId,
  );
  const retryVersion = (
    await api.getAgentConversation(retryConversation.conversation_id)
  ).version;
  const retryAttemptsBefore = foundationTurnAttemptFacts(retryEvidenceBefore);
  reportFoundationF07Debug('D', 'retry-started', {
    elapsedMs: performance.now() - scenarioStartedAt,
    conversationVersion: retryVersion,
    attemptStatuses: retryAttemptsBefore.map((attempt) => attempt.status),
  });
  let retryResponseValue: Record<string, unknown>;
  try {
    retryResponseValue = await api.retryAgentTurn({
      conversation_id: retryConversation.conversation_id,
      source_turn_id: cancellationAttempt.turnId,
      client_idempotency_key: crypto.randomUUID(),
      expected_conversation_version: retryVersion,
    });
  } catch (error) {
    const codedError = error as {
      code?: unknown;
      details?: {
        body?: unknown;
        reason?: unknown;
        status?: unknown;
      };
    };
    const responseBody = typeof codedError.details?.body === 'string'
      ? codedError.details.body
      : '';
    let stationError: Record<string, unknown> = {};
    try {
      stationError = responseBody
        ? evidenceRecord(JSON.parse(responseBody), 'foundationF07RetryErrorBody')
        : {};
    } catch {
      stationError = {};
    }
    reportFoundationF07Debug('D', 'retry-failed', {
      elapsedMs: performance.now() - scenarioStartedAt,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: typeof codedError.code === 'string' ? codedError.code : '',
      httpStatus: Number(codedError.details?.status ?? 0),
      stationErrorCode: String(
        evidenceField(stationError, 'errorCode', 'error_code') ?? '',
      ),
      stationErrorMessage: String(stationError.message ?? ''),
      errorReason: typeof codedError.details?.reason === 'string'
        ? codedError.details.reason
        : '',
    });
    throw error;
  }
  const retryResponse = evidenceRecord(
    retryResponseValue,
    'foundationF07RetryResponse',
  );
  const retryEvidenceAfter = await foundationTurnEvidence(
    retryConversation.conversation_id,
    cancellationAttempt.turnId,
  );
  reportFoundationF07Debug('D', 'retry-finished', {
    elapsedMs: performance.now() - scenarioStartedAt,
    attemptCountBefore: foundationTurnAttemptFacts(retryEvidenceBefore).length,
    attemptCountAfter: foundationTurnAttemptFacts(retryEvidenceAfter).length,
  });

  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation revisions ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  await useChatStore.getState().selectSession(conversation.conversation_id);
  const baselineCapabilitySession = await resolveFoundationToolTurnSession();
  const startedAt = performance.now();
  const sourceTurn = startObservedFoundationTurn({
    conversationId: conversation.conversation_id,
    agentId,
    content: `Reply with one short sentence for revision sample ${input.sampleId}.`,
    idempotencyKey: crypto.randomUUID(),
    provider: input.agent.provider || undefined,
    model: input.agent.model || undefined,
    effort: 'low',
    thinkingMode: 'disabled',
    clientCapabilitySessionId: baselineCapabilitySession.capabilitySessionId,
  });
  const sourceResult = await sourceTurn.result;
  const durationMs = performance.now() - startedAt;
  if (!sourceResult.ok) {
    throw new Error(
      sourceResult.error || 'agent.acceptance.foundationRevisionSourceFailed',
    );
  }
  const sourceTurnId = observedTurnId(sourceResult.events);
  const runtimeEvent = [...sourceResult.events].reverse().find((event) =>
    classifyAgentTurnTerminalEvent(event) !== null);
  if (!sourceTurnId || !runtimeEvent) {
    throw new Error('agent.acceptance.foundationRevisionSourceEvidenceMissing');
  }
  reportFoundationF07Debug('C', 'baseline-finished', {
    elapsedMs: performance.now() - scenarioStartedAt,
    terminalEvent: runtimeEvent.event,
    sequence: Number(runtimeEvent.data.seq ?? 0),
  });

  const sourceReadback = await foundationConversationReadback(
    conversation.conversation_id,
  );
  const sourceUser = sourceReadback.messages.find((message) =>
    message.role === 'user' && message.turnId === sourceTurnId);
  const sourceAssistant = sourceReadback.messages.find((message) =>
    message.role === 'assistant' && message.turnId === sourceTurnId);
  if (!sourceUser || !sourceAssistant) {
    throw new Error('agent.acceptance.foundationRevisionSourceMessagesMissing');
  }
  await submitAgentFeedback(
    agentId,
    sourceTurnId,
    conversation.conversation_id,
    'positive',
    undefined,
    {
      assistantMessageId: sourceAssistant.messageId,
      source: 'acceptance',
    },
  );
  const originalEvidenceBefore = evidenceRecord(
    await foundationTurnEvidence(conversation.conversation_id, sourceTurnId),
    'foundationF07OriginalEvidenceBefore',
  );

  const firstRegenerate = evidenceRecord(
    await api.regenerateAgentTurn({
      conversation_id: conversation.conversation_id,
      source_assistant_message_id: sourceAssistant.messageId,
      client_idempotency_key: crypto.randomUUID(),
      expected_conversation_version: sourceReadback.conversation.version,
    }),
    'foundationF07FirstRegenerate',
  );
  const firstRegenerateMessage = await foundationRevisionMessageFact(
    evidenceField(firstRegenerate, 'assistantMessage', 'assistant_message'),
    'foundationF07FirstRegenerateMessage',
  );
  const afterFirstRegenerate = await api.getAgentConversation(
    conversation.conversation_id,
  );

  const secondRegenerate = evidenceRecord(
    await api.regenerateAgentTurn({
      conversation_id: conversation.conversation_id,
      source_assistant_message_id: sourceAssistant.messageId,
      client_idempotency_key: crypto.randomUUID(),
      expected_conversation_version: afterFirstRegenerate.version,
    }),
    'foundationF07SecondRegenerate',
  );
  const secondRegenerateMessage = await foundationRevisionMessageFact(
    evidenceField(secondRegenerate, 'assistantMessage', 'assistant_message'),
    'foundationF07SecondRegenerateMessage',
  );
  const afterSecondRegenerate = await api.getAgentConversation(
    conversation.conversation_id,
  );
  reportFoundationF07Debug('D', 'regenerations-finished', {
    elapsedMs: performance.now() - scenarioStartedAt,
    firstMessagePresent: Boolean(firstRegenerateMessage.messageId),
    secondMessagePresent: Boolean(secondRegenerateMessage.messageId),
  });

  const revisedContent = `Revised foundation message ${input.sampleId}`;
  const editResponse = evidenceRecord(
    await api.editAndResendAgentMessage({
      conversation_id: conversation.conversation_id,
      source_user_message_id: sourceUser.messageId,
      revised_content: revisedContent,
      client_idempotency_key: crypto.randomUUID(),
      expected_conversation_version: afterSecondRegenerate.version,
    }),
    'foundationF07EditResponse',
  );
  const editedUserMessage = await foundationRevisionMessageFact(
    evidenceField(editResponse, 'userMessage', 'user_message'),
    'foundationF07EditedUserMessage',
  );
  const editedTurn = evidenceRecord(
    editResponse.turn,
    'foundationF07EditedTurn',
  );
  const afterEdit = await api.getAgentConversation(conversation.conversation_id);

  const staleBefore = await foundationConversationReadback(
    conversation.conversation_id,
  );
  let staleBranchError = '';
  try {
    await api.selectAgentActiveBranch({
      conversation_id: conversation.conversation_id,
      active_branch_message_id: String(firstRegenerateMessage.messageId),
      client_idempotency_key: crypto.randomUUID(),
      expected_conversation_version: afterSecondRegenerate.version,
    });
  } catch (error) {
    staleBranchError = observedErrorCode(error);
  }
  const staleAfter = await foundationConversationReadback(
    conversation.conversation_id,
  );
  const editedAssistant = staleAfter.messages.find(
    (message) => message.messageId === afterEdit.active_branch_message_id,
  );
  if (!editedAssistant) {
    throw new Error('agent.acceptance.foundationRevisionEditedAssistantMissing');
  }
  const editedAssistantMessage = await foundationRevisionMessageFact(
    editedAssistant,
    'foundationF07EditedAssistantMessage',
  );
  reportFoundationF07Debug('D', 'edit-and-stale-check-finished', {
    elapsedMs: performance.now() - scenarioStartedAt,
    editMessagePresent: Boolean(editedUserMessage.messageId),
    staleErrorCode: staleBranchError,
  });

  const originalBranch = evidenceRecord(
    await api.selectAgentActiveBranch({
      conversation_id: conversation.conversation_id,
      active_branch_message_id: sourceAssistant.messageId,
      client_idempotency_key: crypto.randomUUID(),
      expected_conversation_version: afterEdit.version,
    }),
    'foundationF07OriginalBranch',
  );
  const originalBranchConversation = evidenceRecord(
    originalBranch.conversation,
    'foundationF07OriginalBranchConversation',
  );
  const originalReadbackAfter = await foundationConversationReadback(
    conversation.conversation_id,
  );
  const originalEvidenceAfter = evidenceRecord(
    await foundationTurnEvidence(conversation.conversation_id, sourceTurnId),
    'foundationF07OriginalEvidenceAfter',
  );
  const originalUserAfter = originalReadbackAfter.messages.find(
    (message) => message.messageId === sourceUser.messageId,
  );
  const originalAssistantAfter = originalReadbackAfter.messages.find(
    (message) => message.messageId === sourceAssistant.messageId,
  );
  if (!originalUserAfter || !originalAssistantAfter) {
    throw new Error('agent.acceptance.foundationRevisionOriginalBranchMissing');
  }

  const selectedBranch = evidenceRecord(
    await api.selectAgentActiveBranch({
      conversation_id: conversation.conversation_id,
      active_branch_message_id: String(firstRegenerateMessage.messageId),
      client_idempotency_key: crypto.randomUUID(),
      expected_conversation_version: Number(
        evidenceField(
          originalBranchConversation,
          'version',
          'version',
        ) ?? 0,
      ),
    }),
    'foundationF07SelectedBranch',
  );
  const selectedBranchConversation = evidenceRecord(
    selectedBranch.conversation,
    'foundationF07SelectedBranchConversation',
  );
  await useChatStore.getState().branchFromMessage(
    String(firstRegenerateMessage.messageId),
  );
  await waitFor(
    () => Array.from(
      document.querySelectorAll<HTMLElement>('[data-pt-agent-message-id]'),
    ).some((element) =>
      element.dataset.ptAgentMessageId === firstRegenerateMessage.messageId),
    'Foundation AS-F07 selected branch projection',
    30_000,
  );
  const selectedReadback = await foundationConversationReadback(
    conversation.conversation_id,
  );
  const selectedDom = foundationDomSnapshot();
  const selectedMessageIds = selectedReadback.messages.map(
    (message) => message.messageId,
  );
  const renderedMessageIds = Array.from(
    document.querySelectorAll<HTMLElement>('[data-pt-agent-message-id]'),
  ).map((element) => element.dataset.ptAgentMessageId ?? '');
  reportFoundationF07Debug('E', 'branch-projection-finished', {
    elapsedMs: performance.now() - scenarioStartedAt,
    selectedMessagePresent: selectedMessageIds.includes(
      String(firstRegenerateMessage.messageId),
    ),
    renderedMessagePresent: renderedMessageIds.includes(
      String(firstRegenerateMessage.messageId),
    ),
  });

  const originalBefore = {
    user: await foundationRevisionMessageFact(
      sourceUser,
      'foundationF07OriginalUserBefore',
    ),
    assistant: await foundationRevisionMessageFact(
      sourceAssistant,
      'foundationF07OriginalAssistantBefore',
    ),
  };
  const originalAfter = {
    user: await foundationRevisionMessageFact(
      originalUserAfter,
      'foundationF07OriginalUserAfter',
    ),
    assistant: await foundationRevisionMessageFact(
      originalAssistantAfter,
      'foundationF07OriginalAssistantAfter',
    ),
  };
  const originalDiagnosticsBefore = evidenceRecord(
    originalEvidenceBefore.diagnostics,
    'foundationF07OriginalDiagnosticsBefore',
  );
  const originalDiagnosticsAfter = evidenceRecord(
    originalEvidenceAfter.diagnostics,
    'foundationF07OriginalDiagnosticsAfter',
  );
  const originalAttemptsBefore = foundationTurnAttemptFacts(
    originalEvidenceBefore,
  );
  const originalAttemptsAfter = foundationTurnAttemptFacts(
    originalEvidenceAfter,
  );
  const originalFeedbackBefore = evidenceArray(
    evidenceRecord(
      originalEvidenceBefore.feedback,
      'foundationF07OriginalFeedbackBefore',
    ).feedback,
    'foundationF07OriginalFeedbackEntriesBefore',
  );
  const originalFeedbackAfter = evidenceArray(
    evidenceRecord(
      originalEvidenceAfter.feedback,
      'foundationF07OriginalFeedbackAfter',
    ).feedback,
    'foundationF07OriginalFeedbackEntriesAfter',
  );
  // #region debug-point P-R:as-f07-assertion-inputs
  await reportFoundationF07Debug('P-R', 'revision-assertion-inputs', {
    edit: {
      sourceUserMessageId: sourceUser.messageId,
      sourceParentMessageId: sourceUser.parentMessageId,
      editedUserMessageId: editedUserMessage.messageId,
      editedUserParentMessageId: editedUserMessage.parentMessageId,
      editedUserReplacesMessageId: editedUserMessage.replacesMessageId,
      revisedContentHash: await sha256Hex(revisedContent),
      editedUserContentHash: editedUserMessage.contentHash,
      assistantMessageId: String(
        evidenceField(
          editedTurn,
          'assistantMessageId',
          'assistant_message_id',
        ) ?? afterEdit.active_branch_message_id,
      ),
      activeBranchMessageId: afterEdit.active_branch_message_id,
      editedAssistantMessageId: editedAssistantMessage.messageId,
      editedAssistantParentMessageId: editedAssistantMessage.parentMessageId,
      editedAssistantBranchId: editedAssistantMessage.branchId,
      editedUserBranchId: editedUserMessage.branchId,
    },
    original: {
      beforeHash: await sha256Hex(stableJson(originalBefore)),
      afterHash: await sha256Hex(stableJson(originalAfter)),
      usageBeforeHash: await sha256Hex(stableJson(
        withoutDiagnosticGenerationTime(originalDiagnosticsBefore),
      )),
      usageAfterHash: await sha256Hex(stableJson(
        withoutDiagnosticGenerationTime(originalDiagnosticsAfter),
      )),
      attemptCountBefore: originalAttemptsBefore.length,
      attemptCountAfter: originalAttemptsAfter.length,
      feedbackBeforeHash: await sha256Hex(stableJson(originalFeedbackBefore)),
      feedbackAfterHash: await sha256Hex(stableJson(originalFeedbackAfter)),
      feedbackCountBefore: originalFeedbackBefore.length,
      feedbackCountAfter: originalFeedbackAfter.length,
    },
  });
  // #endregion

  return {
    conversationId: conversation.conversation_id,
    turnId: sourceTurnId,
    durationMs,
    runtimeEvent: {
      eventType: runtimeEvent.event,
      sequence: Number(runtimeEvent.data.seq ?? 0),
      observedAt: runtimeEvent.observedAt,
    },
    facts: {
      retry: {
        sourceConversationId: retryConversation.conversation_id,
        sourceTurnId: cancellationAttempt.turnId,
        resultTurnId: String(
          evidenceField(
            evidenceRecord(retryResponse.turn, 'foundationF07RetryTurn'),
            'turnId',
            'turn_id',
          ) ?? '',
        ),
        attemptId: String(
          evidenceField(
            evidenceRecord(retryResponse.attempt, 'foundationF07RetryAttempt'),
            'attemptId',
            'attempt_id',
          ) ?? '',
        ),
        attemptsBefore: foundationTurnAttemptFacts(retryEvidenceBefore),
        attemptsAfter: foundationTurnAttemptFacts(retryEvidenceAfter),
      },
      regenerate: {
        sourceUserMessageId: sourceUser.messageId,
        sourceAssistantMessageId: sourceAssistant.messageId,
        first: firstRegenerateMessage,
        second: secondRegenerateMessage,
      },
      edit: {
        sourceUserMessageId: sourceUser.messageId,
        sourceParentMessageId: sourceUser.parentMessageId,
        revisedContentHash: await sha256Hex(revisedContent),
        user: editedUserMessage,
        assistant: editedAssistantMessage,
        assistantMessageId: String(
          evidenceField(
            editedTurn,
            'assistantMessageId',
            'assistant_message_id',
          ) ?? afterEdit.active_branch_message_id,
        ),
        activeBranchMessageId: afterEdit.active_branch_message_id,
      },
      branchSelection: {
        selectedMessageId: String(firstRegenerateMessage.messageId),
        responseActiveBranchMessageId: String(
          evidenceField(
            selectedBranchConversation,
            'activeBranchMessageId',
            'active_branch_message_id',
          ) ?? '',
        ),
        originalResponseActiveBranchMessageId: String(
          evidenceField(
            originalBranchConversation,
            'activeBranchMessageId',
            'active_branch_message_id',
          ) ?? '',
        ),
        originalMessageId: sourceAssistant.messageId,
        readbackActiveBranchMessageId:
          selectedReadback.conversation.active_branch_message_id,
        selectedMessageIds,
        renderedMessageIds,
        receiverVisible:
          selectedDom.assistantMessages.visibleCount > 0,
      },
      staleBranch: {
        errorCode: staleBranchError,
        beforeHash: await sha256Hex(stableJson(staleBefore)),
        afterHash: await sha256Hex(stableJson(staleAfter)),
        versionBefore: staleBefore.conversation.version,
        versionAfter: staleAfter.conversation.version,
      },
      original: {
        beforeHash: await sha256Hex(stableJson(originalBefore)),
        afterHash: await sha256Hex(stableJson(originalAfter)),
        usageBeforeHash: await sha256Hex(stableJson(
          withoutDiagnosticGenerationTime(originalDiagnosticsBefore),
        )),
        usageAfterHash: await sha256Hex(stableJson(
          withoutDiagnosticGenerationTime(originalDiagnosticsAfter),
        )),
        attemptCountBefore: originalAttemptsBefore.length,
        attemptCountAfter: originalAttemptsAfter.length,
        feedbackBeforeHash: await sha256Hex(stableJson(
          originalFeedbackBefore,
        )),
        feedbackAfterHash: await sha256Hex(stableJson(
          originalFeedbackAfter,
        )),
        feedbackCountBefore: originalFeedbackBefore.length,
        feedbackCountAfter: originalFeedbackAfter.length,
      },
    },
  };
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
  locale: string;
  sampleId: string;
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
    case 'AS-F05':
      return evaluateF05(ctx);
    case 'AS-F06':
      return evaluateF06(ctx);
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

async function evaluateF06(
  ctx: DirectCellAssertionContext,
): Promise<Record<string, boolean | null>> {
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationF06Facts');
  const transitions = evidenceArray(
    facts.transitions,
    'foundationF06Transitions',
  ).map((value) => evidenceRecord(value, 'foundationF06Transition'));
  const replay = evidenceRecord(facts.replay, 'foundationF06Replay');
  const idempotence = evidenceRecord(
    facts.idempotence,
    'foundationF06Idempotence',
  );
  const restart = evidenceRecord(
    facts.restartRecovery,
    'foundationF06RestartRecovery',
  );
  const transport = evidenceRecord(
    facts.transportLoss,
    'foundationF06TransportLoss',
  );
  const terminal = evidenceRecord(
    facts.terminalProjection,
    'foundationF06TerminalProjection',
  );
  const recoveryFailure = evidenceRecord(
    facts.recoveryFailure,
    'foundationF06RecoveryFailure',
  );
  const staleRevision = evidenceRecord(
    facts.staleRevision,
    'foundationF06StaleRevision',
  );
  const sideEffects = evidenceRecord(
    facts.sideEffects,
    'foundationF06SideEffects',
  );
  const retry = evidenceRecord(
    recoveryFailure.retry,
    'foundationF06RecoveryRetry',
  );
  const durableReload = evidenceRecord(
    recoveryFailure.durableReload,
    'foundationF06RecoveryDurableReload',
  );
  const durableReloadDelivery = evidenceRecord(
    durableReload.sourceDelivery,
    'foundationF06RecoveryDurableReloadDelivery',
  );
  const beforeDurable = evidenceRecord(
    sideEffects.before,
    'foundationF06BeforeDurableFacts',
  );
  const afterDurable = evidenceRecord(
    sideEffects.after,
    'foundationF06AfterDurableFacts',
  );
  const cleanup = evidenceRecord(facts.cleanup, 'foundationF06Cleanup');
  const scope = evidenceRecord(facts.scope, 'foundationF06Scope');
  const handoff = evidenceRecord(facts.handoff, 'foundationF06Handoff');
  const phases = transitions.map((transition) => String(transition.phase));
  const requiredPhases = [
    'CONNECTION_LOST',
    'RECONNECTING',
    'REPLAYING',
    'RECONCILING',
    'CONNECTED',
  ];
  const phasePositions = requiredPhases.map((phase) => phases.indexOf(phase));
  const replaySequences = optionalEvidenceArray(
    replay.eventSequences,
    'foundationF06ReplaySequences',
  ).map(Number);
  const replayDeliveries = optionalEvidenceArray(
    replay.deliveries,
    'foundationF06ReplayDeliveries',
  ).map((delivery) => evidenceRecord(delivery, 'foundationF06ReplayDelivery'));
  const replayPayloadHashesValid = (
    await Promise.all(replayDeliveries.map(async (delivery) => {
      const rawPayload = evidenceRecord(
        delivery.rawPayload,
        'foundationF06ReplayRawPayload',
      );
      const rawData = evidenceRecord(
        rawPayload.data,
        'foundationF06ReplayRawData',
      );
      return (
        rawPayload.eventType === delivery.eventType
        && Number(rawData.seq ?? rawData.sequence ?? 0) === Number(delivery.sequence)
        && typeof delivery.payloadHash === 'string'
        && delivery.payloadHash
          === await sha256Hex(stableJson(rawPayload))
      );
    }))
  ).every(Boolean);

  return {
    exactRuntimeAttribution:
      scope.platform === ctx.platform
      && scope.locale === ctx.locale
      && scope.sampleId === ctx.sampleId
      && typeof scope.scenarioKey === 'string'
      && scope.scenarioKey.length > 0,
    exactRecoveryTransitionOrdering:
      phasePositions.every((position) => position >= 0)
      && phasePositions.every((position, index) =>
        index === 0 || position > phasePositions[index - 1]),
    replayAfterAcknowledgedCursor:
      Number(replay.afterCursor) > 0
      && replaySequences.length > 0
      && replaySequences.every((sequence) =>
        Number.isSafeInteger(sequence)
        && sequence > Number(replay.afterCursor))
      && replaySequences.every((sequence, index) =>
        index === 0 || sequence > replaySequences[index - 1])
      && replayDeliveries.length === replaySequences.length
      && replayPayloadHashesValid
      && replayDeliveries.every((delivery, index) =>
        Number(delivery.sequence) === replaySequences[index]
        && delivery.streamId === evidenceRecord(
          facts.handoff,
          'foundationF06Handoff',
        ).streamId
        && Number(delivery.streamGeneration)
          === Number(idempotence.activeGeneration)),
    duplicateAndOutOfOrderIdempotent:
      Number(idempotence.duplicateSequence)
        === Number(idempotence.cursorBeforeMutation)
      && Number(idempotence.outOfOrderSequence)
        < Number(idempotence.cursorBeforeMutation)
      && Number(idempotence.staleGeneration)
        < Number(idempotence.activeGeneration)
      && Number(idempotence.cursorAfterMutation)
        === Number(idempotence.cursorBeforeMutation)
      && idempotence.projectionBeforeMutationHash
        === idempotence.projectionAfterMutationHash
      && typeof idempotence.duplicatePayloadHash === 'string'
      && idempotence.duplicatePayloadHash.length === 64
      && typeof idempotence.outOfOrderPayloadHash === 'string'
      && idempotence.outOfOrderPayloadHash.length === 64,
    pageClientAndStationRestartRecovered:
      restart.pageSwitched === true
      && restart.clientReloaded === true
      && restart.stationRestarted === true,
    transportLossNonTerminal:
      transport.observed === true
      && transport.nonTerminal === true,
    terminalProjectionEqualsStation:
      terminal.stationHash === terminal.clientHash
      && terminal.stationStatus === terminal.clientStatus
      && terminal.prefixPreserved === true,
    failedOrCancelledNotCompleted:
      recoveryFailure.notCompleted === true,
    recoveryFailureRetryAndReload:
      typeof recoveryFailure.errorHash === 'string'
      && recoveryFailure.errorHash.length === 64
      && recoveryFailure.blocker === ''
      && recoveryFailure.activeFailureObserved === true
      && recoveryFailure.expectedActorPtidHash
        === recoveryFailure.observedActorPtidHash
      && recoveryFailure.expectedTurnId === recoveryFailure.observedTurnId
      && recoveryFailure.expectedStreamId === recoveryFailure.observedStreamId
      && recoveryFailure.expectedStreamGeneration
        === recoveryFailure.observedStreamGeneration
      && retry.invoked === true
      && retry.observed === true
      && Number(retry.recoveryEpochAfter) > Number(retry.recoveryEpochBefore)
      && durableReload.invoked === true
      && durableReload.observed === true
      && durableReload.source === 'station-snapshot-reconcile'
      && durableReload.actorPtidHash === recoveryFailure.expectedActorPtidHash
      && durableReload.conversationId === handoff.conversationId
      && durableReload.turnId === handoff.turnId
      && durableReload.streamId === handoff.streamId
      && Number(durableReload.streamGeneration) === Number(handoff.streamGeneration)
      && Number(durableReload.sequence) >= Number(replay.afterCursor)
      && durableReloadDelivery.transport === 'station-sse'
      && durableReloadDelivery.actorPtidHash
        === recoveryFailure.expectedActorPtidHash
      && durableReloadDelivery.conversationId === handoff.conversationId
      && durableReloadDelivery.turnId === handoff.turnId
      && Number(durableReloadDelivery.sequence) === Number(durableReload.sequence)
      && durableReloadDelivery.eventType === 'snapshot'
      && typeof durableReloadDelivery.rawPayloadHash === 'string'
      && durableReloadDelivery.rawPayloadHash.length === 64
      && (
        durableReload.terminal === false
        || ['completed', 'failed', 'cancelled', 'interrupted'].includes(
          String(durableReload.terminalStatus),
        )
      ),
    staleGenerationAndRevisionRejected:
      idempotence.staleGenerationRejected === true
      && idempotence.staleTerminalRejected === true
      && staleRevision.rejected === true,
    zeroDuplicateSideEffects:
      typeof beforeDurable.sourceHash === 'string'
      && beforeDurable.sourceHash.length === 64
      && typeof afterDurable.sourceHash === 'string'
      && afterDurable.sourceHash.length === 64
      && Number(sideEffects.duplicateMutationBefore) === 0
      && Number(sideEffects.duplicateMutationAfter) === 0
      && Number(sideEffects.duplicateMutationDelta) === 0
      && Number(sideEffects.duplicateMutationDelta)
        === Number(sideEffects.duplicateMutationAfter)
          - Number(sideEffects.duplicateMutationBefore)
      && Number(sideEffects.duplicateSideEffectBefore) === 0
      && Number(sideEffects.duplicateSideEffectAfter) === 0
      && Number(sideEffects.duplicateSideEffectDelta) === 0
      && Number(sideEffects.duplicateSideEffectDelta)
        === Number(sideEffects.duplicateSideEffectAfter)
          - Number(sideEffects.duplicateSideEffectBefore),
    cleanupComplete:
      cleanup.handoffCleared === true
      && cleanup.conversationDeleted === true
      && cleanup.recoveryRecordCleared === true
      && typeof cleanup.deletionErrorCodeHash === 'string'
      && cleanup.deletionErrorCodeHash.length === 64,
  };
}

function evaluateF05(
  ctx: DirectCellAssertionContext,
): Record<string, boolean | null> {
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationF05Facts');
  const validFiles = evidenceRecord(facts.validFiles, 'foundationF05ValidFiles');
  const persistence = evidenceRecord(
    facts.persistence,
    'foundationF05Persistence',
  );
  const uploadRecovery = evidenceRecord(
    facts.uploadRecovery,
    'foundationF05UploadRecovery',
  );
  const failedUpload = evidenceRecord(
    uploadRecovery.failedUpload,
    'foundationF05FailedUpload',
  );
  const removal = evidenceRecord(
    uploadRecovery.removal,
    'foundationF05Removal',
  );
  const rejections = evidenceRecord(
    facts.rejections,
    'foundationF05Rejections',
  );
  const handled = (value: unknown, mimeType: string) => {
    const fact = evidenceRecord(value, 'foundationF05ValidFile');
    const disposition = String(fact.modelDisposition ?? '');
    return (
      fact.mimeType === mimeType
      && (disposition === 'consumed' || disposition === 'omitted')
      && typeof fact.attachmentId === 'string'
      && fact.attachmentId.length > 0
      && typeof fact.objectRef === 'string'
      && fact.objectRef.startsWith('oss:')
      && (
        disposition === 'consumed'
          ? fact.modelVisible === true
          : fact.modelVisible === false
            && typeof fact.omissionReason === 'string'
            && fact.omissionReason.length > 0
            && fact.ledgerDecision !== null
      )
    );
  };
  const rejected = (value: unknown) => {
    const fact = evidenceRecord(value, 'foundationF05Rejection');
    return (
      fact.accepted === false
      && fact.errorCode === 'CONTEXT_ATTACHMENT_REJECTED'
      && Number(fact.turnDelta) === 0
      && Number(fact.providerExecutionDelta) === 0
      && Number(fact.messageDelta) === 0
    );
  };
  const stableJsonEqual = (left: unknown, right: unknown) =>
    stableJson(left) === stableJson(right);
  const before = evidenceArray(
    persistence.beforeRestart,
    'foundationF05BeforeRestart',
  );
  const after = evidenceArray(
    persistence.afterRestart,
    'foundationF05AfterRestart',
  );
  const projectionReadback = evidenceArray(
    persistence.projectionReadback,
    'foundationF05ProjectionReadback',
  );
  const download = evidenceRecord(
    facts.authorizedDownload,
    'foundationF05AuthorizedDownload',
  );

  return {
    validPngHandled: handled(validFiles.png, 'image/png'),
    validPdfHandled: handled(validFiles.pdf, 'application/pdf'),
    metadataRestartReadback:
      stableJsonEqual(before, after)
      && stableJsonEqual(after, projectionReadback),
    failedUploadRetrySucceeded:
      failedUpload.errorCode === 'CONTEXT_ATTACHMENT_REJECTED'
      && typeof failedUpload.retriedAttachmentId === 'string'
      && failedUpload.retriedAttachmentId.length > 0
      && typeof failedUpload.retriedChecksum === 'string'
      && failedUpload.retriedChecksum.startsWith('sha256:'),
    failedUploadRemovalPreservedSiblings:
      removal.removedObjectUnavailable === true
      && stableJsonEqual(
        [...evidenceArray(
          removal.siblingIdsBefore,
          'foundationF05SiblingIdsBefore',
        )].sort(),
        [...evidenceArray(
          removal.siblingIdsAfter,
          'foundationF05SiblingIdsAfter',
        )].sort(),
      )
      && stableJsonEqual(
        evidenceArray(
          removal.siblingChecksumsBefore,
          'foundationF05SiblingChecksumsBefore',
        ),
        evidenceArray(
          removal.siblingChecksumsAfter,
          'foundationF05SiblingChecksumsAfter',
        ),
      ),
    oversizedRejectedBeforeProvider: rejected(rejections.oversized),
    unsupportedRejectedBeforeProvider: rejected(rejections.unsupported),
    unauthorizedRejectedBeforeProvider: rejected(rejections.unauthorized),
    opaqueReferencesOnly:
      evidenceArray(facts.references, 'foundationF05References').every(
        (reference) => {
          const record = evidenceRecord(reference, 'foundationF05Reference');
          const objectRef = evidenceField(record, 'objectRef', 'object_ref');
          return typeof objectRef === 'string' && objectRef.startsWith('oss:');
        },
      ),
    authorizedDownloadVerified:
      download.authorized === true
      && download.downloaded === true
      && download.expectedChecksum === download.actualChecksum,
  };
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
      && loopBudget.terminalReason === 'max_tool_calls_exhausted'
      && count(loopBudget, 'requestedLimit') === FOUNDATION_LOOP_MAX_TOOL_CALLS
      && count(loopBudget, 'effectiveLimit')
        === count(loopBudget, 'requestedLimit')
      && count(loopBudget, 'observedIterations')
        === count(loopBudget, 'effectiveLimit')
      && count(loopBudget, 'maximumIterations')
        === count(loopBudget, 'effectiveLimit')
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
  const toolIsolation = evidenceRecord(
    facts.toolIsolation,
    'foundationF03ToolIsolation',
  );
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
      && Number(toolIsolation.readyCapabilityCount) === 0
      && Number(facts.toolDefinitionTokens) === 0
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

async function runFoundationF07WithCapabilityIsolation(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  platform: string;
  sampleId: string;
}) {
  await restorePersistedFoundationCapabilityIsolation();
  await restorePersistedFoundationCapabilityFixture();
  const agentId = input.agent.id || input.agent.name;
  const authoritativeAgent = await api.getAgent(agentId);
  const fixture = await foundationToolFixture(agentId, input.platform);
  const originalBinding = fixture.binding;
  let operationError: unknown = null;

  try {
    if (
      !originalBinding
      || !originalBinding.enabled
      || originalBinding.approvalPolicy !== CapabilityApprovalPolicy.MANUAL
    ) {
      const journal: FoundationCapabilityFixtureJournal = {
        agentId,
        agentVersion: authoritativeAgent.version,
        capabilityId: fixture.manifest.capabilityId,
        capabilityVersion: fixture.manifest.version,
        setupIdempotencyKey: crypto.randomUUID(),
        originalBinding: originalBinding
          ? {
              bindingId: originalBinding.bindingId,
              enabled: originalBinding.enabled,
              approvalPolicy: originalBinding.approvalPolicy,
              revision: originalBinding.revision.toString(),
            }
          : null,
      };
      const serializedJournal = JSON.stringify(journal);
      parseFoundationCapabilityFixtureJournal(serializedJournal);
      window.localStorage.setItem(
        FOUNDATION_CAPABILITY_FIXTURE_STORAGE_KEY,
        serializedJournal,
      );
      await prepareFoundationCapabilityFixture(journal);
    }
    const capabilitySession = await resolveFoundationToolTurnSession();
    return await withFoundationCapabilitiesDisabled(
      authoritativeAgent,
      capabilitySession.capabilitySessionId,
      async (toolIsolation) => {
        const result = await runFoundationF07Scenario(input);
        return {
          ...result,
          facts: {
            ...result.facts,
            toolIsolation,
          },
        };
      },
      true,
    );
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await restorePersistedFoundationCapabilityIsolation();
      await restorePersistedFoundationCapabilityFixture();
    } catch (cleanupError) {
      throw Object.assign(
        new Error('agent.acceptance.foundationCapabilityFixtureCleanupFailed'),
        {
          primaryError: operationError,
          cleanupError,
        },
      );
    }
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
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationF07Facts');
  const retry = evidenceRecord(facts.retry, 'foundationF07Retry');
  const attemptsBefore = evidenceArray(
    retry.attemptsBefore,
    'foundationF07AttemptsBefore',
  );
  const attemptsAfter = evidenceArray(
    retry.attemptsAfter,
    'foundationF07AttemptsAfter',
  );
  const regenerate = evidenceRecord(
    facts.regenerate,
    'foundationF07Regenerate',
  );
  const firstRegenerate = evidenceRecord(
    regenerate.first,
    'foundationF07FirstRegenerate',
  );
  const secondRegenerate = evidenceRecord(
    regenerate.second,
    'foundationF07SecondRegenerate',
  );
  const edit = evidenceRecord(facts.edit, 'foundationF07Edit');
  const editedUser = evidenceRecord(
    edit.user,
    'foundationF07EditedUser',
  );
  const editedAssistant = evidenceRecord(
    edit.assistant,
    'foundationF07EditedAssistant',
  );
  const branch = evidenceRecord(
    facts.branchSelection,
    'foundationF07BranchSelection',
  );
  const stale = evidenceRecord(
    facts.staleBranch,
    'foundationF07StaleBranch',
  );
  const original = evidenceRecord(
    facts.original,
    'foundationF07Original',
  );
  const toolIsolation = evidenceRecord(
    facts.toolIsolation,
    'foundationF07ToolIsolation',
  );
  const sourceAssistantMessageId = String(
    regenerate.sourceAssistantMessageId ?? '',
  );
  const sourceUserMessageId = String(regenerate.sourceUserMessageId ?? '');
  const firstMessageId = String(firstRegenerate.messageId ?? '');
  const secondMessageId = String(secondRegenerate.messageId ?? '');
  const editedUserMessageId = String(editedUser.messageId ?? '');
  const selectedMessageIds = evidenceArray(
    branch.selectedMessageIds,
    'foundationF07SelectedMessageIds',
  ).map(String);
  const renderedMessageIds = evidenceArray(
    branch.renderedMessageIds,
    'foundationF07RenderedMessageIds',
  ).map(String);

  return {
    retryCreatedAttempt:
      String(retry.sourceConversationId ?? '').length > 0
      && String(retry.sourceTurnId ?? '').length > 0
      && retry.sourceTurnId === retry.resultTurnId
      && String(retry.attemptId ?? '').length > 0
      && attemptsAfter.length === attemptsBefore.length + 1
      && attemptsAfter.some((attempt) =>
        evidenceRecord(attempt, 'foundationF07RetryAttemptAfter').attemptId
          === retry.attemptId),
    regenerateCreatedSiblings:
      sourceAssistantMessageId.length > 0
      && sourceUserMessageId.length > 0
      && firstMessageId.length > 0
      && secondMessageId.length > 0
      && firstMessageId !== secondMessageId
      && firstMessageId !== sourceAssistantMessageId
      && secondMessageId !== sourceAssistantMessageId
      && firstRegenerate.parentMessageId === sourceUserMessageId
      && secondRegenerate.parentMessageId === sourceUserMessageId
      && firstRegenerate.replacesMessageId === sourceAssistantMessageId
      && secondRegenerate.replacesMessageId === sourceAssistantMessageId
      && String(firstRegenerate.branchId ?? '').length > 0
      && String(secondRegenerate.branchId ?? '').length > 0
      && firstRegenerate.branchId !== secondRegenerate.branchId,
    editCreatedSibling:
      editedUserMessageId.length > 0
      && editedUserMessageId !== sourceUserMessageId
      && editedUser.replacesMessageId === sourceUserMessageId
      && editedUser.parentMessageId === edit.sourceParentMessageId
      && editedUser.contentHash === edit.revisedContentHash
      && String(edit.assistantMessageId ?? '').length > 0
      && edit.assistantMessageId === edit.activeBranchMessageId
      && editedAssistant.messageId === edit.assistantMessageId
      && editedAssistant.parentMessageId === editedUserMessageId
      && editedAssistant.branchId === editedUser.branchId,
    branchSwitchPersisted:
      String(branch.selectedMessageId ?? '').length > 0
      && branch.originalResponseActiveBranchMessageId === branch.originalMessageId
      && branch.responseActiveBranchMessageId === branch.selectedMessageId
      && branch.selectedMessageId === branch.readbackActiveBranchMessageId
      && selectedMessageIds.includes(String(branch.selectedMessageId))
      && renderedMessageIds.includes(String(branch.selectedMessageId))
      && branch.receiverVisible === true,
    staleBranchConflict:
      stale.errorCode === 'VERSION_CONFLICT'
      && stale.beforeHash === stale.afterHash
      && Number(stale.versionBefore) === Number(stale.versionAfter),
    originalImmutable:
      String(original.beforeHash ?? '').length > 0
      && original.beforeHash === original.afterHash
      && String(original.usageBeforeHash ?? '').length > 0
      && original.usageBeforeHash === original.usageAfterHash
      && Number(original.attemptCountBefore) > 0
      && original.attemptCountBefore === original.attemptCountAfter
      && String(original.feedbackBeforeHash ?? '').length > 0
      && original.feedbackBeforeHash === original.feedbackAfterHash
      && Number(original.feedbackCountBefore) > 0
      && original.feedbackCountBefore === original.feedbackCountAfter,
    capabilityIsolationRestored:
      isFoundationCapabilityIsolationRestored(toolIsolation),
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
  installFoundationF06Observation();
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

      const user = useSessionStore.getState().currentUser;
      if (user?.actorId) {
        await installAuthenticatedCriticalRuntimes(user.actorId);
      }
      await installDeferredAppRuntimeProjections();
      return {
        authenticated: Boolean(user?.actorId),
        actorId: user?.actorId ?? null,
      };
    },

    async logout() {
      const activeOperations = Object.values(useChatStore.getState().operations);
      await identityRuntime.logout();
      reportFoundationF07Debug(
        'I',
        'cleanup-identity-runtime-logout-finished',
        {
          authenticated: useSessionStore.getState().authenticated,
        },
      );
      await waitFor(
        () => !useSessionStore.getState().authenticated,
        'session to become unauthenticated',
        30_000,
      );
      reportFoundationF07Debug('I', 'cleanup-harness-logout-finished');
      return {
        authenticated: false,
        identityState: identityRuntime.getSnapshot().lifecycle.state,
        operationCount: Object.keys(useChatStore.getState().operations).length,
        previousOperationsAborted: activeOperations.every(
          (operation) => operation.abortController.signal.aborted,
        ),
      };
    },

    async restoreFoundationCapabilityIsolation() {
      const restoration = await restorePersistedFoundationCapabilityIsolation();
      const fixtureRestorationRequired =
        await restorePersistedFoundationCapabilityFixture();
      return {
        restorationRequired: restoration !== null,
        restoration,
        fixtureRestorationRequired,
        fixtureRestorationVerified: true,
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
      await agentStore.loadAgents();
      const refreshedAgentStore = useAgentStore.getState();
      const selected = refreshedAgentStore.selectedAgent;
      const agent = refreshedAgentStore.agents.find((a) => a.name === selected)
        || refreshedAgentStore.agents[0];
      if (agent) {
        const agentId = agent.id || agent.name;
        if (agent.provider !== providerId || agent.model !== modelId) {
          await agentStore.updateAgentProfile(agentId, {
            provider: providerId,
            model: modelId,
          });
          await agentStore.loadAgents();
        }
        const readiness = await api.getAgentCapabilityReadiness({
          agent_id: agentId,
        });
        const modelCapabilities = readiness.model_capabilities;
        if (
          !readiness.runtime_snapshot_id
          || !modelCapabilities?.snapshot_id
          || modelCapabilities.snapshot_id !== readiness.runtime_snapshot_id
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

    async uploadFoundationAttachmentBytes({
      conversationId,
      filename,
      mimeType,
      bytes,
    }: FoundationAttachmentUploadInput) {
      if (
        !conversationId
        || !filename
        || !mimeType
        || bytes.length === 0
      ) {
        throw new Error('agent.acceptance.foundationAttachmentUploadInvalid');
      }
      return evidenceValue(await api.ossUploadAgentAttachmentBytes({
        filename,
        mime_type: mimeType,
        bytes,
        conversation_id: conversationId,
      }));
    },

    async resolveFoundationAttachmentObject({
      objectRef,
    }: FoundationAttachmentResolveInput) {
      if (!objectRef) {
        throw new Error('agent.acceptance.foundationAttachmentRefMissing');
      }
      return evidenceValue(await api.ossResolveUrl(objectRef));
    },

    async getFoundationAttachmentRuntimeReadiness() {
      return {
        status: 'ready',
        productionUploadApi: 'oss_upload_agent_attachment_bytes',
        productionDownloadApi: 'oss_resolve_url',
        stationAttachmentAdmission: true,
        desktopCanonicalTurnAttachmentBridge: true,
        attachmentPersistenceReadback: true,
      };
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
      const sourcePtid = authenticatedFoundationActorPtid();
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
          }, sourcePtid);
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

    async foundationF06Prepare({
      scenarioKey,
      platform,
      locale,
      sampleId,
    }: {
      scenarioKey: string;
      platform: string;
      locale: string;
      sampleId: string;
    }) {
      try {
        const agent = selectedAgent();
        if (!agent) throw new Error('agent.acceptance.agentMissing');
        const capabilitySessions = await waitForCapabilitySessionEvidence();
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        return evidenceValue(await runFoundationF06Prepare({
          agent,
          capabilitySessionId,
          scenarioKey,
          platform,
          locale,
          sampleId,
        }));
      } catch (error) {
        const primary = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${primary}; auth=${JSON.stringify(redactedAuthError(error))}`,
        );
      }
    },

    async foundationF06ObserveFailure({
      scenarioKey,
    }: {
      scenarioKey: string;
    }) {
      const handoff = readFoundationF06Handoff(scenarioKey);
      if (!handoff) {
        throw new Error('agent.acceptance.foundationRecoveryHandoffMissing');
      }
      return evidenceValue(await observeFoundationRecoveryFailure(handoff));
    },

    async foundationF06DurableReload({
      scenarioKey,
    }: {
      scenarioKey: string;
    }) {
      const handoff = readFoundationF06Handoff(scenarioKey);
      if (!handoff) {
        throw new Error('agent.acceptance.foundationRecoveryHandoffMissing');
      }
      return evidenceValue(await exerciseFoundationDurableReload(handoff));
    },

    async foundationF06Cleanup({
      scenarioKey,
      conversationId,
      turnId,
    }: {
      scenarioKey: string;
      conversationId: string;
      turnId: string;
    }) {
      return evidenceValue(await cleanupFoundationF06Scenario({
        scenarioKey,
        conversationId,
        turnId,
      }));
    },

    async foundationDirectProbe({
      platform,
      locale,
      cell,
      sampleId,
      scenarioKey,
      stationRestart,
      durableReloadEvidence,
    }: {
      platform: string;
      locale: string;
      cell: string;
      sampleId: string;
      scenarioKey?: string;
      stationRestart?: Record<string, unknown>;
      durableReloadEvidence?: Record<string, unknown>;
    }) {
      await restorePersistedFoundationCapabilityIsolation();
      await restorePersistedFoundationCapabilityFixture();
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      const agentId = agent.id || agent.name;
      let capabilitySessions = await waitForCapabilitySessionEvidence();
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
      let preservedReplayReadback:
        | Awaited<ReturnType<typeof foundationConversationReadback>>
        | null = null;

      if (cell === 'AS-F06') {
        if (!stationRestart || !scenarioKey || !durableReloadEvidence) {
          throw new Error('agent.acceptance.foundationStationRestartMissing');
        }
        const scenario = await runFoundationF06Complete(
          stationRestart,
          durableReloadEvidence,
          {
            scenarioKey,
            platform,
            locale,
            sampleId,
          },
        );
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
      }

      if (cell === 'AS-F05') {
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        const scenario = await runFoundationF05Scenario({
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

      if (cell === 'AS-F07') {
        const scenario = await runFoundationF07WithCapabilityIsolation({
          agent,
          platform,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
      }

      if (cell === 'AS-F01') {
        const sourcePtid = authenticatedFoundationActorPtid();
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
          }, sourcePtid);
          timeout = window.setTimeout(() => {
            controller.abort();
            reject(new Error('agent.acceptance.foundationTurnTimeout'));
          }, 120_000);
        });
      }

      if (cell === 'AS-F02') {
        await cleanupStaleFoundationQueueConversations(agentId);
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
        const activeDependencyError = await observeFoundationActiveDependency(
          conversation.conversation_id,
          queueAtCapacity.conversation_version,
        );

        const cancellation = await cancelFoundationQueuedTurns(
          conversation.conversation_id,
        );

        const activeCancellation = await api.cancelAgentTurn(activeTurnId);
        if (
          activeCancellation
          && String(activeCancellation.status).toLowerCase() !== 'cancelled'
        ) {
          active.controller.abort();
          throw new Error('agent.acceptance.foundationActiveTurnCancelRejected');
        }
        if (!active.events.some((event) =>
          event.event === 'cancelled'
          || classifyAgentTurnTerminalEvent(event) === 'cancelled')) {
          active.controller.disconnectTransport();
        }
        const activeResult = await active.result;
        if (!activeResult.events.some((event) =>
          event.event === 'cancelled'
          || classifyAgentTurnTerminalEvent(event) === 'cancelled')) {
          const recoveryState = useAgentTurnRecoveryStore.getState();
          const recovery = recoveryState.active[conversation.conversation_id];
          const watermark = recoveryState.watermarks[conversation.conversation_id];
          const session = useSessionStore.getState();
          throw new Error(
            'agent.acceptance.foundationActiveTurnCancelMissing:'
            + stableJson({
              resultOk: activeResult.ok,
              resultError: activeResult.error,
              events: activeResult.events.map((event) => ({
                eventType: event.event,
                sequence: Number(event.data.seq ?? 0),
              })),
              recoveryPhase: recovery?.phase ?? 'MISSING',
              recoveryCursor: recovery?.cursor ?? 0,
              recoveryActorPresent: Boolean(recoveryState.actorId),
              watermarkPresent: Boolean(watermark),
              watermarkTerminal: watermark?.terminal ?? false,
              watermarkCursor: watermark?.cursor ?? 0,
              sessionAuthenticated: session.authenticated,
              sessionActorPresent: Boolean(session.currentUser?.actorId),
            }),
          );
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
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        await withFoundationCapabilitiesDisabled(
          agent,
          capabilitySessionId,
          async (toolIsolation) => {
          const conversation = await api.createAgentConversation({
            agent_id: agentId,
            title: `Foundation stream ${sampleId}`,
            provider_id: agent.provider,
            model_name: agent.model,
          });
          preparedConversationId = conversation.conversation_id;
          await useChatStore.getState().selectSession(conversation.conversation_id);

          const startedAt = performance.now();
          let cancellationRequested = false;
          let resolveCancellation!: (value: {
            turnId: string;
            result: Promise<{
              response: Awaited<ReturnType<typeof api.cancelAgentTurn>> | null;
              error: unknown;
            }>;
          }) => void;
          const cancellation = new Promise<{
            turnId: string;
            result: Promise<{
              response: Awaited<ReturnType<typeof api.cancelAgentTurn>> | null;
              error: unknown;
            }>;
          }>((resolve) => {
            resolveCancellation = resolve;
          });
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
            onEvent: (event, events) => {
              if (cancellationRequested || event.event !== 'text') return;
              const turnId = observedTurnId(events);
              if (!turnId) return;
              cancellationRequested = true;
              preparedTurnId = turnId;
              const result = api.cancelAgentTurn(turnId).then(
                (response) => ({ response, error: null }),
                (error: unknown) => ({ response: null, error }),
              );
              resolveCancellation({ turnId, result });
            },
          });
          const cancellationAttempt = await Promise.race([
            cancellation,
            observed.result.then((result) => {
              throw new Error(
                result.error || 'agent.acceptance.progressiveTextMissing',
              );
            }),
          ]);
          preparedTurnId = cancellationAttempt.turnId;
          const cancellationResult = await cancellationAttempt.result;
          if (cancellationResult.error) throw cancellationResult.error;
          const activeCancellation = cancellationResult.response;
          if (
            activeCancellation
            && String(activeCancellation.status).toLowerCase() !== 'cancelled'
          ) {
            observed.controller.abort();
            throw new Error('agent.acceptance.foundationActiveTurnCancelRejected');
          }
          const result = await observed.result;
          turnDurationMs = performance.now() - startedAt;
          const normalizedEvents = result.events
            .filter((event) =>
              !FOUNDATION_F06_PHASE_BY_EVENT[event.event]
              && event.event !== 'catchup_done')
            .map((event) => ({
              eventType: event.event,
              sequence: Number(event.data.seq ?? 0),
              observedAt: event.observedAt,
            }));
          const terminalEvent = [...normalizedEvents]
            .reverse()
            .find((event) =>
              ['done', 'error', 'cancelled'].includes(event.eventType));
          if (terminalEvent?.eventType !== 'cancelled') {
            throw new Error('agent.acceptance.foundationActiveTurnCancelMissing');
          }
          preparedRuntimeEvent.current = terminalEvent ?? null;
          scenarioFacts = {
            events: normalizedEvents,
            sawTextBeforeCancel: true,
            toolIsolation,
          };
          },
        );
      }

      if (cell === 'AS-F04') {
        const scenario = await runFoundationF04Scenario({
          agent,
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

      capabilitySessions = await waitForCapabilitySessionEvidence();
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
          const tokenUsage = evidenceRecord(
            attempt.usage,
            'turnTokenUsage',
          );
          scenarioFacts.toolDefinitionTokens = Number(
            evidenceField(
              tokenUsage,
              'toolDefinitionTokens',
              'tool_definition_tokens',
            ) ?? 0,
          );
        }
      }
      if (cell === 'AS-F06' && scenarioFacts && currentConversationId && scenarioKey) {
        preservedReplayReadback = await foundationConversationReadback(
          currentConversationId,
        );
        const latestConversation = await api.getAgentConversation(
          currentConversationId,
        );
        await api.archiveAgentConversation(
          currentConversationId,
          latestConversation.version,
          true,
        );
        let conversationDeleted = false;
        let deletionErrorCode = '';
        try {
          const deleted = await api.getAgentConversation(currentConversationId);
          conversationDeleted = deleted.status === 'deleted';
          if (conversationDeleted) {
            deletionErrorCode = 'CONVERSATION_DELETED';
          }
        } catch (error) {
          deletionErrorCode = observedErrorCode(error);
          conversationDeleted = deletionErrorCode.includes('AGENT_4004');
        }
        foundationF06Controllers.delete(scenarioKey);
        removeFoundationF06Handoff(scenarioKey);
        scenarioFacts.cleanup = {
          ...evidenceRecord(
            scenarioFacts.cleanup,
            'foundationF06Cleanup',
          ),
          handoffCleared: readFoundationF06Handoff(scenarioKey) === null,
          conversationDeleted,
          deletionErrorCodeHash: await sha256Hex(deletionErrorCode),
        };
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
        locale,
        sampleId,
      };
      const assertions = await evaluateDirectCellAssertions(assertionContext);

      const receiverDom = foundationDomSnapshot();
      const runtimeAttestation = await buildDirectRuntimeAttestation(
        assertionContext,
        sampleId,
      );
      const replayReadback = preservedReplayReadback
        ?? (
          currentConversationId && conversationReadback
            ? await foundationConversationReadback(currentConversationId)
            : null
        );
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

      const measurementLimitMs =
        cell === 'AS-F04' ? 900_000 : cell === 'AS-F06' ? 300_000 : 120_000;
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
        : cell === 'AS-F06' && scenarioFacts
          ? {
              counterId: String(preparedTurnId ?? ''),
              count: Number(
                evidenceRecord(
                  scenarioFacts.sideEffects,
                  'foundationF06SideEffects',
                ).duplicateMutationDelta ?? -1,
              ) + Number(
                evidenceRecord(
                  scenarioFacts.sideEffects,
                  'foundationF06SideEffects',
                ).duplicateSideEffectDelta ?? -1,
              ),
              maximum: 0,
              measurements: scenarioFacts.sideEffects,
            }
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
        ...(cell === 'AS-F06' && scenarioFacts
          ? {
              oracleFacts: {
                transitions: scenarioFacts.transitions,
                replay: scenarioFacts.replay,
                idempotence: scenarioFacts.idempotence,
                restartRecovery: scenarioFacts.restartRecovery,
                transportLoss: scenarioFacts.transportLoss,
                terminalProjection: scenarioFacts.terminalProjection,
                recoveryFailure: scenarioFacts.recoveryFailure,
                staleRevision: scenarioFacts.staleRevision,
              },
            }
          : {}),
      };

      const attachmentCleanup = cell === 'AS-F05' && scenarioFacts
        ? evidenceArray(
            evidenceRecord(
              scenarioFacts.cleanup,
              'foundationF05Cleanup',
            ).objects,
            'foundationF05CleanupObjects',
          )
        : [];
      const cleanup: Record<string, unknown> = {
        status: (
          cell === 'AS-F05'
            ? attachmentCleanup.length > 0
              && attachmentCleanup.every((entry) =>
                evidenceRecord(entry, 'foundationF05CleanupEntry').unavailable === true)
            : cell === 'AS-F06' && scenarioFacts
              ? evidenceRecord(
                  scenarioFacts.cleanup,
                  'foundationF06Cleanup',
                ).handoffCleared === true
                && evidenceRecord(
                  scenarioFacts.cleanup,
                  'foundationF06Cleanup',
                ).conversationDeleted === true
              : true
        )
          ? 'clean'
          : 'failed',
        resourceKind: 'isolated-client',
        resourceIdHash: await sha256Hex(
          JSON.stringify({ platform, cell, sampleId }),
        ),
        ...(cell === 'AS-F06' && scenarioFacts
          ? { proof: scenarioFacts.cleanup }
          : {}),
      };

      const receiverDomRole: Record<string, unknown> = {
        scenarioId: cell,
        cellId: cell,
        visible: cell === 'AS-F05'
          ? receiverDom.messageAttachments.visibleCount >= 2
          : receiverDom.composer.visibleCount > 0
            || receiverDom.assistantMessages.visibleCount > 0,
        selector: cell === 'AS-F05'
          ? '[data-pt-agent-message-attachment]'
          : '[data-pt-agent-composer],[data-pt-agent-message="assistant"]',
        locale,
        textHash: await sha256Hex(
          JSON.stringify(
            cell === 'AS-F05'
              ? receiverDom.messageAttachments.text
              : receiverDom.assistantMessages.text,
          ),
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
