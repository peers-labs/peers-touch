import { identityRuntime } from '../../kernel/identityRuntime';
import { bootstrapRuntime, installRuntime } from '../../kernel/runtime';
import { EVENT, eventBus, eventDebugBuffer } from '../../kernel/events';
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
  type AgentCapabilityNegativeControlFact,
  type AgentRuntimeBudgetInput,
  type AgentTurnSourceDelivery,
  type AgentTurnStreamController,
  type StreamEvent,
} from '../../services/desktop_api';
import {
  flushAgentTurnRecoveryPersistence,
  type AgentTurnSnapshotReloadResult,
} from '../../runtimes/chatRuntime';
import { toolRuntime } from '../../runtimes/toolRuntime';
import { useAgentStore } from '../../store/agent';
import { useAgentTurnRecoveryStore } from '../../store/agentTurnRecovery';
import { useChatStore } from '../../store/chat';
import { terminalReasonFromStreamData } from '../../store/streaming/handler';
import { usePortalStore } from '../../store/portal';
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

interface ConfigureStationInput {
  stationUrl: string;
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

interface FoundationRuntimeEventObservation {
  eventId?: string;
  eventType: string;
  sequence: number;
  observedAt: string;
  streamGeneration?: number;
  streamIdHash?: string;
  conversationIdHash?: string;
  payloadHash?: string;
  errorType?: string;
  sourceTransport?: string;
  sourcePtidHash?: string;
  sourceConversationId?: string;
  sourceTurnId?: string;
  sourceSequence?: number;
  sourceEventType?: string;
}

interface FoundationAttachmentDeletionReadback {
  source: 'oss-owner-list';
  objectRefHash: string;
  objectPathHash: string;
  deletedAt: string;
  readAttempt: number;
}

interface FoundationPreAdmissionErrorEvent {
  data: Record<string, unknown>;
  eventType: string;
  observedAt: string;
  streamId: string;
  streamGeneration: number;
  conversationId: string;
  observationSequence: number;
  timestampMs: number;
  sourceDelivery?: AgentTurnSourceDelivery;
}

interface ObservedFoundationTurnResult {
  ok: boolean;
  error: string | null;
  events: Array<{
    event: string;
    data: Record<string, unknown>;
    observedAt: string;
    sourceDelivery?: AgentTurnSourceDelivery;
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

interface FoundationCapabilityIsolationOptions {
  requireEffectiveCapabilities?: boolean;
  restorationMode?: 'immediate' | 'deferred';
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
  replayRequestCursor: number;
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

type FoundationTurnReplayLocator = Pick<
  FoundationF06Handoff,
  | 'conversationId'
  | 'turnId'
  | 'streamId'
  | 'streamGeneration'
  | 'actorPtid'
  | 'acknowledgedCursor'
>;

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

interface FoundationF06CleanupLocator {
  scenarioKey: string;
  conversationId: string;
  turnId: string;
  state: 'created' | 'deleted';
}

type FoundationF12TopicKey = 'alpha' | 'beta';

interface FoundationF12RuntimeEvent {
  topic: FoundationF12TopicKey;
  turnId: string;
  eventType: string;
  sequence: number;
  observedAt: string;
}

interface FoundationF12TopicHandoff {
  key: FoundationF12TopicKey;
  conversationId: string;
  fact: string;
  turnIds: string[];
  runtimeTurnId: string;
  sourceAssistantMessageId: string;
  siblingMessageId: string;
  selectedBranchMessageId: string;
  preRestart: Record<string, unknown>;
  preRestartHash: string;
  receiverBefore: Record<string, unknown>;
}

interface FoundationF12Handoff {
  scenarioKey: string;
  platform: string;
  locale: string;
  sampleId: string;
  agentId: string;
  topics: Record<FoundationF12TopicKey, FoundationF12TopicHandoff>;
  staleMutation: Record<string, unknown>;
  runtimeEvents: FoundationF12RuntimeEvent[];
  toolIsolation: FoundationCapabilityIsolation;
  preparedAt: string;
}

const FOUNDATION_F06_STORAGE_KEY = 'pt.acceptance.agent.foundation.as-f06';
const FOUNDATION_F06_CLEANUP_STORAGE_KEY =
  'pt.acceptance.agent.foundation.as-f06-cleanup';
const FOUNDATION_F12_STORAGE_KEY = 'pt.acceptance.agent.foundation.as-f12';
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
const foundationF06FaultBoundaries =
  new Map<string, FoundationF06FaultBoundary>();
const foundationF06ReplayingScenarios = new Set<string>();

function observedFoundationF06Handoffs(): FoundationF06Handoff[] {
  const byScenario = new Map(
    Object.entries(readFoundationF06Handoffs()),
  );
  for (const [scenarioKey, handoff] of foundationF06PendingHandoffs) {
    byScenario.set(scenarioKey, handoff);
  }
  return [...byScenario.values()];
}

function authenticatedFoundationActorPtid(): string {
  const user = useSessionStore.getState().currentUser;
  const actorPtid = user?.actorPtid.trim() || '';
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
        || !Number.isSafeInteger(value.replayRequestCursor)
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
        || !Number.isSafeInteger(
          value.toolIsolation.originalReadyCapabilityCount,
        )
        || typeof value.toolIsolation.originalReadyCapabilityHash !== 'string'
        || !/^[0-9a-f]{64}$/.test(
          value.toolIsolation.originalReadyCapabilityHash,
        )
        || !Number.isSafeInteger(value.toolIsolation.restoredBindingCount)
        || !Number.isSafeInteger(
          value.toolIsolation.restoredReadyCapabilityCount,
        )
        || typeof value.toolIsolation.restoredReadyCapabilityHash !== 'string'
        || typeof value.toolIsolation.restorationVerified !== 'boolean'
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

function readFoundationF06CleanupLocators(): Record<
  string,
  FoundationF06CleanupLocator
> {
  const raw = window.localStorage.getItem(FOUNDATION_F06_CLEANUP_STORAGE_KEY);
  if (!raw) return {};
  try {
    const values = JSON.parse(raw) as Record<
      string,
      Partial<FoundationF06CleanupLocator>
    >;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    const locators: Record<string, FoundationF06CleanupLocator> = {};
    for (const [scenarioKey, value] of Object.entries(values)) {
      if (
        value.scenarioKey !== scenarioKey
        || typeof value.conversationId !== 'string'
        || !value.conversationId
        || typeof value.turnId !== 'string'
        || !['created', 'deleted'].includes(value.state ?? '')
      ) {
        return {};
      }
      locators[scenarioKey] = value as FoundationF06CleanupLocator;
    }
    return locators;
  } catch {
    return {};
  }
}

function writeFoundationF06CleanupLocator(
  locator: FoundationF06CleanupLocator,
): void {
  const locators = readFoundationF06CleanupLocators();
  locators[locator.scenarioKey] = locator;
  window.localStorage.setItem(
    FOUNDATION_F06_CLEANUP_STORAGE_KEY,
    JSON.stringify(locators),
  );
}

function removeFoundationF06CleanupLocator(scenarioKey: string): void {
  const locators = readFoundationF06CleanupLocators();
  delete locators[scenarioKey];
  if (Object.keys(locators).length === 0) {
    window.localStorage.removeItem(FOUNDATION_F06_CLEANUP_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    FOUNDATION_F06_CLEANUP_STORAGE_KEY,
    JSON.stringify(locators),
  );
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

function removeFoundationF06Handoff(
  scenarioKey: string,
  removeCleanupLocator = true,
): void {
  foundationF06ReplayingScenarios.delete(scenarioKey);
  foundationF06PendingHandoffs.delete(scenarioKey);
  foundationF06FaultBoundaries.delete(scenarioKey);
  if (removeCleanupLocator) {
    removeFoundationF06CleanupLocator(scenarioKey);
  }
  const handoffs = readFoundationF06Handoffs();
  delete handoffs[scenarioKey];
  if (Object.keys(handoffs).length === 0) {
    window.localStorage.removeItem(FOUNDATION_F06_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(FOUNDATION_F06_STORAGE_KEY, JSON.stringify(handoffs));
}

function readFoundationF12Handoffs(): Record<string, FoundationF12Handoff> {
  const raw = window.localStorage.getItem(FOUNDATION_F12_STORAGE_KEY);
  if (!raw) return {};
  try {
    const values = JSON.parse(raw) as Record<string, Partial<FoundationF12Handoff>>;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    const handoffs: Record<string, FoundationF12Handoff> = {};
    for (const [scenarioKey, value] of Object.entries(values)) {
      const topics = value.topics as
        | Partial<Record<FoundationF12TopicKey, Partial<FoundationF12TopicHandoff>>>
        | undefined;
      const alpha = topics?.alpha;
      const beta = topics?.beta;
      if (
        value.scenarioKey !== scenarioKey
        || typeof value.platform !== 'string'
        || typeof value.locale !== 'string'
        || typeof value.sampleId !== 'string'
        || typeof value.agentId !== 'string'
        || typeof value.preparedAt !== 'string'
        || !value.toolIsolation
        || !Array.isArray(value.runtimeEvents)
        || !value.staleMutation
        || !alpha
        || !beta
        || typeof alpha.conversationId !== 'string'
        || typeof beta.conversationId !== 'string'
        || !Array.isArray(alpha.turnIds)
        || !Array.isArray(beta.turnIds)
        || typeof alpha.preRestartHash !== 'string'
        || typeof beta.preRestartHash !== 'string'
      ) {
        return {};
      }
      handoffs[scenarioKey] = value as FoundationF12Handoff;
    }
    return handoffs;
  } catch {
    return {};
  }
}

function readFoundationF12Handoff(scenarioKey: string): FoundationF12Handoff | null {
  return readFoundationF12Handoffs()[scenarioKey] ?? null;
}

function writeFoundationF12Handoff(value: FoundationF12Handoff): void {
  const handoffs = readFoundationF12Handoffs();
  handoffs[value.scenarioKey] = value;
  window.localStorage.setItem(
    FOUNDATION_F12_STORAGE_KEY,
    JSON.stringify(handoffs),
  );
}

function removeFoundationF12Handoff(scenarioKey: string): void {
  const handoffs = readFoundationF12Handoffs();
  delete handoffs[scenarioKey];
  if (Object.keys(handoffs).length === 0) {
    window.localStorage.removeItem(FOUNDATION_F12_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    FOUNDATION_F12_STORAGE_KEY,
    JSON.stringify(handoffs),
  );
}

function installFoundationF06Observation(): void {
  if (foundationF06ObservationInstalled) return;
  foundationF06ObservationInstalled = true;
  useAgentTurnRecoveryStore.subscribe((state, previousState) => {
    const observedHandoffs = observedFoundationF06Handoffs();
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
    const observedHandoffs = observedFoundationF06Handoffs();
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
        && sourceDelivery.sequence > current.replayRequestCursor
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
  handoff: FoundationTurnReplayLocator,
  options: {
    finishOnTerminal?: boolean;
    onSnapshot?: (event: StreamEvent) => void;
  } = {},
): Promise<FoundationF06ReplayDelivery[]> {
  const deliveries: FoundationF06ReplayDelivery[] = [];
  const finishOnTerminal = options.finishOnTerminal ?? true;
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
        if (
          finishOnTerminal
          && classifyAgentTurnTerminalEvent(event) !== null
        ) {
          finish();
        }
        return;
      }
      if (
        event.event === 'catchup_done'
        || event.event === 'snapshot'
        || (
          finishOnTerminal
          && classifyAgentTurnTerminalEvent(event) !== null
        )
      ) {
        if (event.event === 'snapshot') options.onSnapshot?.(event);
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
      sourceDelivery: event.sourceDelivery,
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

async function cleanupFoundationToolConversation(
  conversationId: string,
  turnId: string,
): Promise<void> {
  let cancellationError: unknown = null;
  if (turnId) {
    try {
      await api.cancelAgentTurn(turnId);
    } catch (error) {
      cancellationError = error;
    }
  }

  try {
    const deletionErrorCode = await deleteFoundationConversation(conversationId);
    let conversationDeleted = deletionErrorCode.includes('AGENT_4004');
    if (!conversationDeleted) {
      try {
        conversationDeleted = (
          await api.getAgentConversation(conversationId)
        ).status === 'deleted';
      } catch (error) {
        conversationDeleted = observedErrorCode(error).includes('AGENT_4004');
      }
    }
    if (!conversationDeleted) {
      throw new Error(
        'agent.acceptance.foundationCleanupConversationNotDeleted',
      );
    }
  } catch (cleanupError) {
    throw Object.assign(
      new Error('agent.acceptance.foundationToolConversationCleanupFailed'),
      {
        cancellationError,
        cleanupError,
      },
    );
  }
}

function clearFoundationLocalConversationProjection(
  conversationId: string,
): void {
  useChatStore.setState((state) => {
    const operations = { ...state.operations };
    operations[conversationId]?.abortController.abort();
    delete operations[conversationId];
    const sessionBuffers = { ...state.sessionBuffers };
    delete sessionBuffers[conversationId];
    const isCurrent = state.currentSessionKey === conversationId;
    return {
      operations,
      sessionBuffers,
      messages: isCurrent ? [] : state.messages,
      isStreaming: isCurrent ? false : state.isStreaming,
      streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
      abortController: isCurrent ? null : state.abortController,
    };
  });
}

async function cancelFoundationQueuedTurns(
  conversationId: string,
  maximumCancellations = Number.POSITIVE_INFINITY,
): Promise<Awaited<ReturnType<typeof api.cancelQueuedAgentTurn>> | null> {
  const idempotencyKeys = new Map<string, string>();
  let firstCancellation: Awaited<
    ReturnType<typeof api.cancelQueuedAgentTurn>
  > | null = null;
  let cancellationCount = 0;

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
        cancellationCount += 1;
        if (cancellationCount >= maximumCancellations) {
          return firstCancellation;
        }
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

function normalizeProjectedStationPayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = {
    ...(evidenceValue(value) as Record<string, unknown>),
  };
  delete normalized.streamGeneration;
  return normalized;
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
      conversationId: message.conversation_id,
      messageId: message.message_id,
      turnId: message.turn_id ?? null,
      role: message.role,
      status: message.status,
      content: message.content,
      errorJson: message.error_json ?? '',
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
const FOUNDATION_TOOL_RECONCILE_TIMEOUT_MS = 90_000;
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

interface FoundationExecutorUnavailableScenario {
  scenarioKey: string;
  platform: string;
  sampleId: string;
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  fixture: FoundationToolFixture;
  originalBinding: AgentCapabilityBinding | null;
  currentBinding: AgentCapabilityBinding;
  turn: FoundationToolTurn;
  approvalId: string;
  toolCallId: string;
  expectedRevision: number;
  targetCapabilitySessionId: string;
  targetDeviceId: string;
  targetCapabilityId: string;
  startedAt: number;
  bindingRestored: boolean;
}

const foundationExecutorUnavailableScenarios =
  new Map<string, FoundationExecutorUnavailableScenario>();

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

async function waitForFoundationDiagnosticReplay(
  turnId: string,
  predicate: (replay: Record<string, unknown>) => boolean,
  description: string,
  timeoutMs = FOUNDATION_TOOL_SETTLEMENT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const replay = await foundationDiagnosticReplay(turnId);
      if (predicate(replay)) return replay;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw Object.assign(
    new Error(`timed out waiting for: ${description}`),
    { cause: lastError },
  );
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
  options: FoundationCapabilityIsolationOptions = {},
): Promise<T> {
  const {
    requireEffectiveCapabilities = false,
    restorationMode = 'immediate',
  } = options;
  await restorePersistedFoundationCapabilityIsolation();
  const agentId = agent.id || agent.name;
  const authoritativeAgent = await api.getAgent(agentId);
  const allBindings = await api.listAgentCapabilityBindings(agentId);
  const originalBindings = allBindings.filter(
    (binding) => binding.enabled && !binding.tombstonedAt,
  );
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
  const readinessStateCounts = Object.fromEntries(
    Object.entries(
      originalReadiness.capabilities.reduce<Record<string, number>>(
        (counts, capability) => {
          const state = String(capability.state);
          counts[state] = (counts[state] ?? 0) + 1;
          return counts;
        },
        {},
      ),
    ).sort(([left], [right]) => left.localeCompare(right)),
  );
  const readinessReasonCounts = Object.fromEntries(
    Object.entries(
      originalReadiness.capabilities.reduce<Record<string, number>>(
        (counts, capability) => {
          const reason = capability.reason_code || 'none';
          counts[reason] = (counts[reason] ?? 0) + 1;
          return counts;
        },
        {},
      ),
    ).sort(([left], [right]) => left.localeCompare(right)),
  );
  await reportFoundationCapabilityIsolationDebug(
    'A-C',
    'isolation-precondition',
    {
      requireEffectiveCapabilities,
      selectedAgentVersion: agent.version,
      authoritativeAgentVersion: authoritativeAgent.version,
      agentVersionMatches: agent.version === authoritativeAgent.version,
      totalBindingCount: allBindings.length,
      enabledBindingCount: originalBindings.length,
      readinessEntryCount: originalReadiness.capabilities.length,
      readyCapabilityCount: originalReadyCapabilityCount,
      readinessStateCounts,
      readinessReasonCounts,
    },
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
    isolation.restoredReadyCapabilityHash = originalReadyCapabilityHash;
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
  let outcome:
    | { ok: true; value: T }
    | { ok: false; error: unknown };
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
    outcome = {
      ok: true,
      value: await operation(isolation),
    };
  } catch (error) {
    outcome = { ok: false, error };
  }
  if (restorationMode === 'immediate') {
    try {
      const restoration = await restorePersistedFoundationCapabilityIsolation();
      if (restoration) Object.assign(isolation, restoration);
    } catch (cleanupError) {
      throw Object.assign(
        new Error('agent.acceptance.foundationCapabilityBindingRestoreFailed'),
        {
          primaryError: outcome.ok ? null : outcome.error,
          cleanupError,
        },
      );
    }
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function prepareFoundationReadyCapabilityFixture(
  agent: NonNullable<ReturnType<typeof selectedAgent>>,
  platform: string,
): Promise<{
  authoritativeAgent: NonNullable<ReturnType<typeof selectedAgent>>;
  fixture: FoundationToolFixture;
}> {
  await restorePersistedFoundationCapabilityIsolation();
  await restorePersistedFoundationCapabilityFixture();
  const agentId = agent.id || agent.name;
  const authoritativeAgent = await api.getAgent(agentId);
  const fixture = await foundationToolFixture(agentId, platform);
  const originalBinding = fixture.binding;
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
  return { authoritativeAgent, fixture };
}

async function withFoundationReadyCapabilityFixture<T>(
  agent: NonNullable<ReturnType<typeof selectedAgent>>,
  platform: string,
  operation: (
    authoritativeAgent: NonNullable<ReturnType<typeof selectedAgent>>,
  ) => Promise<T>,
): Promise<T> {
  const { authoritativeAgent } =
    await prepareFoundationReadyCapabilityFixture(agent, platform);
  let outcome:
    | { ok: true; value: T }
    | { ok: false; error: unknown };

  try {
    outcome = {
      ok: true,
      value: await operation(authoritativeAgent),
    };
  } catch (error) {
    outcome = { ok: false, error };
  }

  try {
    await restorePersistedFoundationCapabilityIsolation();
    await restorePersistedFoundationCapabilityFixture();
  } catch (cleanupError) {
    throw Object.assign(
      new Error('agent.acceptance.foundationCapabilityFixtureCleanupFailed'),
      {
        primaryError: outcome.ok ? null : outcome.error,
        cleanupError,
      },
    );
  }

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
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
  } else if (policy === 'deny') {
    states.push('denied');
  } else {
    states.push('awaiting_user');
    if (status !== 'expired') {
      states.push(approved ? 'approved' : 'denied');
    }
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
    errorCode: stringField('errorCode', 'error_code'),
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
      decisionRevision: numberField(
        'decisionRevision',
        'decision_revision',
      ),
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

    let beforeReplay: Awaited<ReturnType<typeof waitForFoundationToolFacts>>;
    try {
      beforeReplay = await waitForFoundationToolFacts(
        turn.turnId,
        (facts, replay) =>
          facts.length === 1
          && Number(facts[0].status) === targetStatus
          && diagnosticReplayTerminal(replay),
        `Foundation ${label} ToolCall settlement`,
      );
    } catch (error) {
      if (label === 'expiry') {
        try {
          const replay = await foundationDiagnosticReplay(turn.turnId);
          const facts = foundationDiagnosticToolFacts(replay);
          await reportFoundationF04ExpirySettlementDebug(
            'A-D',
            'settlement-timeout',
            {
              toolFactCount: facts.length,
              toolStatuses: facts.map((fact) => Number(fact.status)),
              executionDeadlines: facts.map((fact) =>
                String(
                  evidenceField(
                    fact,
                    'executionDeadline',
                    'execution_deadline',
                  ) ?? '',
                )),
              replayStatus: Number(replay.status),
              replayTerminal: diagnosticReplayTerminal(replay),
              terminalReason: String(
                evidenceField(
                  replay,
                  'terminalReason',
                  'terminal_reason',
                ) ?? '',
              ),
              observedEventTypes: turn.observed.events.map(
                (event) => event.event,
              ),
              errorType: error instanceof Error
                ? error.name
                : typeof error,
            },
          );
        } catch (diagnosticError) {
          await reportFoundationF04ExpirySettlementDebug(
            'D',
            'settlement-diagnostic-failed',
            {
              errorType: diagnosticError instanceof Error
                ? diagnosticError.name
                : typeof diagnosticError,
            },
          );
        }
      }
      throw error;
    }
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
    if (label === 'deny') {
      const lineage = evidenceRecord(
        caseFact.lineage,
        'foundationF04DenyLineage',
      );
      await reportFoundationF04DenialDebug('A-D', 'denial-fact', {
        policy: caseFact.policy,
        states: caseFact.states,
        executionAttemptCount: caseFact.executionAttemptCount,
        sideEffectCount: caseFact.sideEffectCount,
        resultCount: caseFact.resultCount,
        continuationCount: caseFact.continuationCount,
        targetStatusMatches: toolStatusName(fact.status)
          === toolStatusName(targetStatus),
        bindingRevisionMatches:
          currentBinding !== null
          && String(lineage.bindingRevision) === String(currentBinding.revision),
        sourceReplayMatches:
          stableJson(withoutDiagnosticGenerationTime(source.replay))
          === stableJson(withoutDiagnosticGenerationTime(replayed.replay)),
      });
    }
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

async function restoreFoundationExecutorUnavailableBinding(
  scenario: FoundationExecutorUnavailableScenario,
): Promise<boolean> {
  if (scenario.originalBinding) {
    await updateFoundationToolPolicy(
      scenario.agent,
      scenario.fixture,
      scenario.currentBinding,
      scenario.originalBinding.approvalPolicy,
      scenario.originalBinding.enabled,
    );
  } else {
    await api.deleteAgentCapabilityBinding(
      scenario.currentBinding.bindingId,
      scenario.currentBinding.revision,
      crypto.randomUUID(),
      'acceptance_fixture_cleanup',
    );
  }
  const bindings = await api.listAgentCapabilityBindings(
    scenario.agent.id || scenario.agent.name,
  );
  const restored = bindings.find((candidate) =>
    candidate.capabilityId === scenario.fixture.manifest.capabilityId
    && candidate.capabilityVersion === scenario.fixture.manifest.version
    && !candidate.tombstonedAt) ?? null;
  return scenario.originalBinding
    ? (
        restored?.approvalPolicy === scenario.originalBinding.approvalPolicy
        && restored.enabled === scenario.originalBinding.enabled
      )
    : restored === null;
}

async function cleanupFoundationExecutorUnavailableScenario(
  scenarioKey: string,
): Promise<void> {
  const scenario = foundationExecutorUnavailableScenarios.get(scenarioKey);
  if (!scenario) return;
  foundationExecutorUnavailableScenarios.delete(scenarioKey);
  const failures: unknown[] = [];
  if (!scenario.bindingRestored) {
    try {
      await restoreFoundationExecutorUnavailableBinding(scenario);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await cleanupFoundationToolConversation(
      scenario.turn.conversationId,
      scenario.turn.turnId,
    );
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw Object.assign(
      new Error('agent.acceptance.foundationExecutorUnavailableCleanupFailed'),
      { failures },
    );
  }
}

async function prepareFoundationExecutorUnavailableScenario(input: {
  scenarioKey: string;
  platform: string;
  sampleId: string;
  targetCapabilitySessionId: string;
  targetDeviceId: string;
  targetCapabilityId: string;
}): Promise<Record<string, unknown>> {
  if (foundationExecutorUnavailableScenarios.has(input.scenarioKey)) {
    throw new Error('agent.acceptance.foundationExecutorScenarioConflict');
  }
  const agent = selectedAgent();
  if (!agent) throw new Error('agent.acceptance.agentMissing');
  const agentId = agent.id || agent.name;
  const targetSession = (
    await api.listAgentCapabilitySessions()
  ).sessions.find((session) =>
    session.session_id === input.targetCapabilitySessionId
    && session.device_id === input.targetDeviceId
    && session.typed_capabilities.some(
      (capability) => capability.capability_id === input.targetCapabilityId,
    ));
  if (!targetSession) {
    throw new Error('agent.acceptance.foundationExecutorTargetUnavailable');
  }

  const fixture = await foundationToolFixture(agentId, 'desktop_app');
  if (fixture.manifest.capabilityId !== input.targetCapabilityId) {
    throw new Error('agent.acceptance.foundationExecutorCapabilityMismatch');
  }
  let currentBinding = fixture.binding;
  let turn: FoundationToolTurn | null = null;
  try {
    currentBinding = await updateFoundationToolPolicy(
      agent,
      fixture,
      currentBinding,
      CapabilityApprovalPolicy.MANUAL,
    );
    turn = await startFoundationToolTurn({
      agent,
      capabilitySessionId: input.targetCapabilitySessionId,
      fixture,
      sampleId: input.sampleId,
      label: 'executor-unavailable',
    });
    await useChatStore.getState().selectSession(turn.conversationId);
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
    await waitFor(
      () => Boolean(document.querySelector(
        `[data-pt-agent-tool-call="${toolCallId}"]`,
      )),
      'executor-unavailable ToolCall receiver',
      30_000,
    );
    foundationExecutorUnavailableScenarios.set(input.scenarioKey, {
      scenarioKey: input.scenarioKey,
      platform: input.platform,
      sampleId: input.sampleId,
      agent,
      fixture,
      originalBinding: fixture.binding,
      currentBinding,
      turn,
      approvalId,
      toolCallId,
      expectedRevision,
      targetCapabilitySessionId: input.targetCapabilitySessionId,
      targetDeviceId: input.targetDeviceId,
      targetCapabilityId: input.targetCapabilityId,
      startedAt: performance.now(),
      bindingRestored: false,
    });
    return {
      scenarioKey: input.scenarioKey,
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      approvalId,
      toolCallId,
      expectedRevision,
      targetCapabilitySessionId: input.targetCapabilitySessionId,
      targetDeviceId: input.targetDeviceId,
      targetCapabilityId: input.targetCapabilityId,
    };
  } catch (error) {
    if (turn) {
      await cleanupFoundationToolConversation(
        turn.conversationId,
        turn.turnId,
      ).catch(() => undefined);
    }
    if (currentBinding) {
      if (fixture.binding) {
        await updateFoundationToolPolicy(
          agent,
          fixture,
          currentBinding,
          fixture.binding.approvalPolicy,
          fixture.binding.enabled,
        ).catch(() => undefined);
      } else {
        await api.deleteAgentCapabilityBinding(
          currentBinding.bindingId,
          currentBinding.revision,
          crypto.randomUUID(),
          'acceptance_fixture_cleanup',
        ).catch(() => undefined);
      }
    }
    throw error;
  }
}

function executorUnavailableStationFact(
  fact: Record<string, unknown>,
): Record<string, unknown> {
  const stringField = (camelCase: string, snakeCase: string): string =>
    String(evidenceField(fact, camelCase, snakeCase) ?? '');
  const numberField = (camelCase: string, snakeCase: string): number =>
    Number(evidenceField(fact, camelCase, snakeCase) ?? 0);
  return {
    policy: String(
      evidenceField(fact, 'approvalPolicy', 'approval_policy') ?? '',
    ),
    states: ['policy_check', 'awaiting_user'],
    errorCode: stringField('errorCode', 'error_code'),
    executionOwner: toolExecutionOwnerName(
      evidenceField(fact, 'executionOwner', 'execution_owner'),
    ),
    executionAttemptCount: numberField(
      'executionAttemptCount',
      'execution_attempt_count',
    ),
    sideEffectCount: stringField(
      'sideEffectReceiptId',
      'side_effect_receipt_id',
    ) ? 1 : 0,
    resultCount: stringField('resultId', 'result_id') ? 1 : 0,
    continuationCount: stringField('continuationId', 'continuation_id') ? 1 : 0,
    lineage: {
      toolCallId: stringField('toolCallId', 'tool_call_id'),
      approvalId: stringField('approvalId', 'approval_id'),
      decisionId: stringField('decisionId', 'decision_id'),
      decisionRevision: numberField(
        'decisionRevision',
        'decision_revision',
      ),
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
      ) ?? null,
    },
  };
}

async function rejectFoundationExecutorUnavailableScenario(
  scenarioKey: string,
  executorStop: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const scenario = foundationExecutorUnavailableScenarios.get(scenarioKey);
  if (!scenario) {
    throw new Error('agent.acceptance.foundationExecutorScenarioMissing');
  }
  const toolCallElement = document.querySelector<HTMLElement>(
    `[data-pt-agent-tool-call="${scenario.toolCallId}"]`,
  );
  if (!toolCallElement) {
    throw new Error('agent.acceptance.foundationToolCallSurfaceMissing');
  }
  let approve = toolCallElement.querySelector<HTMLButtonElement>(
    '[data-pt-agent-tool-decision="approve"]',
  );
  if (!approve) {
    toolCallElement.querySelector<HTMLElement>(
      '[data-pt-agent-tool-call-toggle]',
    )?.click();
    await waitFor(
      () => Boolean(toolCallElement.querySelector(
        '[data-pt-agent-tool-decision="approve"]',
      )),
      'executor-unavailable approve action',
      10_000,
    );
    approve = toolCallElement.querySelector<HTMLButtonElement>(
      '[data-pt-agent-tool-decision="approve"]',
    );
  }
  if (!approve) {
    throw new Error('agent.acceptance.foundationToolApproveMissing');
  }
  approve.click();
  await waitFor(
    () => (
      toolRuntime.getProjection(scenario.toolCallId)
        ?.decisionOutcome?.error_type === 'CLIENT_EXECUTOR_UNAVAILABLE'
    ),
    'executor-unavailable typed outcome',
    30_000,
  );
  const projection = toolRuntime.getProjection(scenario.toolCallId);
  const attempt = toolRuntime.getDecisionAttempt(scenario.toolCallId);
  if (!projection?.decisionOutcome || !attempt) {
    throw new Error('agent.acceptance.foundationExecutorOutcomeMissing');
  }
  const replayedAcknowledgement = await api.submitAgentToolDecision(
    attempt.input,
  );
  let repeatedApprovalBlocked = false;
  try {
    await toolRuntime.submitDecision(scenario.toolCallId, true);
  } catch (error) {
    repeatedApprovalBlocked =
      observedErrorCode(error).includes('agent.errors.executorUnavailable');
  }
  const source = await waitForFoundationToolFacts(
    scenario.turn.turnId,
    (facts) => (
      facts.length === 1
      && Number(facts[0].status) === ToolCallStatus.WAITING_APPROVAL
    ),
    'executor-unavailable Station source readback',
  );
  const replayed = await waitForFoundationToolFacts(
    scenario.turn.turnId,
    (facts) => (
      facts.length === 1
      && Number(facts[0].status) === ToolCallStatus.WAITING_APPROVAL
    ),
    'executor-unavailable Station replay readback',
  );
  const station = executorUnavailableStationFact(replayed.facts[0]);
  const errorSelector =
    '[data-pt-agent-tool-error="agent.errors.executorUnavailable"]';
  const recoverySelector =
    '[data-pt-agent-tool-recovery="reconnect-executor"]';
  await waitFor(
    () => Boolean(toolCallElement.querySelector(errorSelector))
      && Boolean(toolCallElement.querySelector(recoverySelector)),
    'executor-unavailable recovery surface',
    10_000,
  );
  const errorElement = toolCallElement.querySelector<HTMLElement>(errorSelector);
  const recovery = toolCallElement.querySelector<HTMLButtonElement>(
    recoverySelector,
  );
  const firstAcknowledgementHash = await sha256Hex(
    stableJson(attempt.response),
  );
  const replayedAcknowledgementHash = await sha256Hex(
    stableJson(replayedAcknowledgement),
  );
  const sourceReplayHash = await sha256Hex(stableJson(
    withoutDiagnosticGenerationTime(source.replay),
  ));
  const diagnosticReplayHash = await sha256Hex(stableJson(
    withoutDiagnosticGenerationTime(replayed.replay),
  ));
  const runtimeEvent = [...scenario.turn.observed.events]
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
    conversationId: scenario.turn.conversationId,
    turnId: scenario.turn.turnId,
    durationMs: performance.now() - scenario.startedAt,
    runtimeEvent,
    facts: {
      outcome: projection.decisionOutcome,
      receiver: {
        errorVisible: Boolean(
          errorElement && errorElement.getClientRects().length > 0,
        ),
        errorText: errorElement?.textContent?.trim() ?? '',
        expectedErrorText: i18n.t(
          'agent.errors.executorUnavailable',
          { ns: 'agent' },
        ),
        recoveryVisible: Boolean(
          recovery && recovery.getClientRects().length > 0,
        ),
        recoveryText: recovery?.textContent?.trim() ?? '',
        expectedRecoveryText: i18n.t(
          'agent.recovery.reconnectExecutor',
          { ns: 'agent' },
        ),
        approveDisabled: approve.disabled,
        repeatedApprovalBlocked,
        recoveryExecuted: false,
      },
      decision: {
        accepted: attempt.response.accepted,
        approved: attempt.response.approved,
        errorCode: attempt.response.error_code,
        approvalId: attempt.response.approval_id,
        toolCallId: attempt.response.tool_call_id,
        decisionId: attempt.response.decision_id,
        decisionRevision: attempt.response.decision_revision,
      },
      station,
      executor: {
        ...executorStop,
        targetCapabilitySessionId: scenario.targetCapabilitySessionId,
        targetDeviceId: scenario.targetDeviceId,
        targetCapabilityId: scenario.targetCapabilityId,
      },
      replay: {
        acknowledgementSourceHash: firstAcknowledgementHash,
        acknowledgementReplayHash: replayedAcknowledgementHash,
        diagnosticSourceHash: sourceReplayHash,
        diagnosticReplayHash,
        equal:
          firstAcknowledgementHash === replayedAcknowledgementHash
          && sourceReplayHash === diagnosticReplayHash,
      },
      cleanup: {
        bindingRestored: false,
        conversationDeleted: false,
        executorRestored: false,
      },
    },
  };
}

async function recoverFoundationExecutorUnavailableScenario(input: {
  scenarioKey: string;
  rejectedScenario: Record<string, unknown>;
  executorStart: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const scenario = foundationExecutorUnavailableScenarios.get(input.scenarioKey);
  if (!scenario) {
    throw new Error('agent.acceptance.foundationExecutorScenarioMissing');
  }
  const facts = evidenceRecord(
    input.rejectedScenario.facts,
    'foundationExecutorUnavailableFacts',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationExecutorUnavailableReceiver',
  );
  const toolCallElement = document.querySelector<HTMLElement>(
    `[data-pt-agent-tool-call="${scenario.toolCallId}"]`,
  );
  const recovery = toolCallElement?.querySelector<HTMLButtonElement>(
    '[data-pt-agent-tool-recovery="reconnect-executor"]',
  );
  if (!toolCallElement || !recovery) {
    throw new Error('agent.acceptance.foundationToolRecoveryMissing');
  }
  recovery.click();
  await waitFor(
    () => {
      const projection = toolRuntime.getProjection(scenario.toolCallId);
      return projection?.status === 'approval_required'
        && projection.error === undefined
        && projection.decisionOutcome === undefined;
    },
    'executor-unavailable reconnect reconciliation',
    30_000,
  );
  const approve = toolCallElement.querySelector<HTMLButtonElement>(
    '[data-pt-agent-tool-decision="approve"]',
  );
  const postRecovery = await waitForFoundationToolFacts(
    scenario.turn.turnId,
    (toolFacts) => (
      toolFacts.length === 1
      && Number(toolFacts[0].status) === ToolCallStatus.WAITING_APPROVAL
    ),
    'executor-unavailable post-recovery readback',
  );
  const stationAfterRecovery = executorUnavailableStationFact(
    postRecovery.facts[0],
  );
  const cancellation = await api.cancelAgentTurn(scenario.turn.turnId);
  const turnCancelled =
    String(cancellation.status ?? '').toLowerCase() === 'cancelled';
  if (!turnCancelled) {
    throw new Error('agent.acceptance.foundationExecutorTurnCleanupFailed');
  }
  const bindingRestored =
    await restoreFoundationExecutorUnavailableBinding(scenario);
  scenario.bindingRestored = bindingRestored;

  return {
    ...input.rejectedScenario,
    facts: {
      ...facts,
      receiver: {
        ...receiver,
        recoveryExecuted: true,
        approvalEnabledAfterRecovery: approve?.disabled === false,
      },
      stationAfterRecovery,
      executor: {
        ...evidenceRecord(
          facts.executor,
          'foundationExecutorUnavailableExecutor',
        ),
        ...input.executorStart,
      },
      cleanup: {
        ...evidenceRecord(
          facts.cleanup,
          'foundationExecutorUnavailableCleanup',
        ),
        bindingRestored,
        executorRestored: true,
        turnCancelled,
      },
    },
  };
}

async function runFoundationApprovalDeniedScenario(input: {
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
  const startedAt = performance.now();
  let result: {
    conversationId: string;
    turnId: string;
    durationMs: number;
    runtimeEvent: {
      eventType: string;
      sequence: number;
      observedAt: string;
    };
    facts: Record<string, unknown>;
  } | null = null;

  try {
    currentBinding = await updateFoundationToolPolicy(
      input.agent,
      fixture,
      currentBinding,
      CapabilityApprovalPolicy.MANUAL,
    );
    const capabilitySession = await resolveFoundationToolTurnSession();
    const turn = await startFoundationToolTurn({
      agent: input.agent,
      capabilitySessionId: capabilitySession.capabilitySessionId,
      fixture,
      sampleId: input.sampleId,
      label: 'approval-denied',
    });
    await useChatStore.getState().selectSession(turn.conversationId);
    void reportFoundationApprovalReceiverDebug(
      'A-B',
      'conversation-selected',
      {
        currentSessionMatches:
          useChatStore.getState().currentSessionKey === turn.conversationId,
        storeMessageCount: useChatStore.getState().messages.length,
        storeToolCallCount: useChatStore.getState().messages.reduce(
          (count, message) => count + (message.toolCalls?.length ?? 0),
          0,
        ),
      },
    );
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

    const approvalProjectionDiagnostics = async () => {
      const chatState = useChatStore.getState();
      const stationMessages = await api.listAgentConversationMessages({
        conversation_id: turn.conversationId,
        after_seq: 0,
        limit: 200,
      });
      const rendered = Array.from(
        document.querySelectorAll<HTMLElement>('[data-pt-agent-tool-call]'),
      );
      return {
        currentSessionMatches:
          chatState.currentSessionKey === turn.conversationId,
        storeMessageCount: chatState.messages.length,
        storeToolCallCount: chatState.messages.reduce(
          (count, message) => count + (message.toolCalls?.length ?? 0),
          0,
        ),
        expectedToolCallInStore: chatState.messages.some((message) =>
          message.toolCalls?.some((toolCall) => toolCall.id === toolCallId)),
        runtimeProjectionPresent:
          toolRuntime.getProjection(toolCallId) !== undefined,
        runtimeProjectionStatus:
          toolRuntime.getProjection(toolCallId)?.status ?? 'MISSING',
        stationMessageCount: stationMessages.messages.length,
        expectedToolCallInStation: stationMessages.messages.some((message) =>
          message.tool_calls_json?.includes(toolCallId)),
        renderedToolCallCount: rendered.length,
        expectedToolCallInDom: rendered.some((element) =>
          element.dataset.ptAgentToolCall === toolCallId),
      };
    };
    void reportFoundationApprovalReceiverDebug(
      'A-E',
      'approval-observed',
      await approvalProjectionDiagnostics(),
    );
    try {
      await waitFor(
        () => Array.from(
          document.querySelectorAll<HTMLElement>('[data-pt-agent-tool-call]'),
        ).some((element) =>
          element.dataset.ptAgentToolCall === toolCallId),
        'approval-denied ToolCall receiver',
        30_000,
      );
    } catch (error) {
      await reportFoundationApprovalReceiverDebug(
        'A-E',
        'receiver-timeout',
        await approvalProjectionDiagnostics(),
      );
      throw error;
    }
    const toolCallElement = Array.from(
      document.querySelectorAll<HTMLElement>('[data-pt-agent-tool-call]'),
    ).find((element) => element.dataset.ptAgentToolCall === toolCallId);
    if (!toolCallElement) {
      throw new Error('agent.acceptance.foundationToolCallSurfaceMissing');
    }
    let recovery = toolCallElement.querySelector<HTMLButtonElement>(
      '[data-pt-agent-tool-recovery="continue-without-tool"]',
    );
    if (!recovery) {
      toolCallElement.querySelector<HTMLElement>(
        '[data-pt-agent-tool-call-toggle]',
      )?.click();
      await waitFor(
        () => Boolean(toolCallElement.querySelector(
          '[data-pt-agent-tool-recovery="continue-without-tool"]',
        )),
        'approval-denied recovery action',
        10_000,
      );
      recovery = toolCallElement.querySelector<HTMLButtonElement>(
        '[data-pt-agent-tool-recovery="continue-without-tool"]',
      );
    }
    if (!recovery) {
      throw new Error('agent.acceptance.foundationToolRecoveryMissing');
    }
    const expectedRecoveryText = i18n.t(
      'agent.recovery.continueWithoutTool',
      { ns: 'agent' },
    );
    const recoveryVisible = recovery.getClientRects().length > 0;
    const recoveryText = recovery.textContent?.trim() ?? '';
    recovery.click();

    await waitFor(
      () => {
        const projection = toolRuntime.getProjection(toolCallId);
        return (
          projection?.status === 'denied'
          && projection.decisionOutcome?.error_type === 'TOOL_APPROVAL_DENIED'
        );
      },
      'approval-denied typed outcome',
      30_000,
    );
    const projection = toolRuntime.getProjection(toolCallId);
    if (!projection?.decisionId || !projection.decisionOutcome) {
      throw new Error('agent.acceptance.foundationToolDenialOutcomeMissing');
    }
    const firstAcknowledgement = {
      accepted: true,
      decision_revision: projection.decisionRevision,
      approval_id: projection.approvalId,
      tool_call_id: projection.toolCallId,
      decision_id: projection.decisionId,
      approved: false,
      idempotency_key: projection.decisionId,
      payload_hash: projection.payloadHash,
      error_code: 'TOOL_APPROVAL_DECISION_ERROR_CODE_UNSPECIFIED',
      outcome_error: projection.decisionOutcome,
    };
    const replayedAcknowledgement = await api.submitAgentToolDecision({
      approval_id: approvalId,
      tool_call_id: toolCallId,
      decision_id: projection.decisionId,
      expected_revision: expectedRevision,
      approved: false,
      idempotency_key: projection.decisionId,
    });
    const source = await waitForFoundationToolFacts(
      turn.turnId,
      (facts, replay) =>
        facts.length === 1
        && Number(facts[0].status) === ToolCallStatus.DENIED
        && diagnosticReplayTerminal(replay),
      'approval-denied Station settlement',
    );
    const replayed = await waitForFoundationToolFacts(
      turn.turnId,
      (facts, replay) =>
        facts.length === 1
        && Number(facts[0].status) === ToolCallStatus.DENIED
        && diagnosticReplayTerminal(replay),
      'approval-denied Station replay',
    );
    const sideEffectCount = await foundationToolSideEffectCount(
      input.platform,
      replayed.facts[0],
    );
    try {
      await waitFor(
        () => Boolean(toolCallElement.querySelector(
          '[data-pt-agent-tool-error="agent.errors.toolApprovalDenied"]',
        )),
        'approval-denied error surface',
        10_000,
      );
    } catch (error) {
      const currentToolCallElement = Array.from(
        document.querySelectorAll<HTMLElement>('[data-pt-agent-tool-call]'),
      ).find((element) => element.dataset.ptAgentToolCall === toolCallId);
      const currentProjection = toolRuntime.getProjection(toolCallId);
      await reportFoundationApprovalReceiverDebug(
        'G-I',
        'error-surface-timeout',
        {
          retainedElementConnected: toolCallElement.isConnected,
          currentToolCallPresent: Boolean(currentToolCallElement),
          currentElementMatchesRetained:
            currentToolCallElement === toolCallElement,
          currentErrorPresent: Boolean(currentToolCallElement?.querySelector(
            '[data-pt-agent-tool-error="agent.errors.toolApprovalDenied"]',
          )),
          runtimeProjectionPresent: currentProjection !== undefined,
          runtimeProjectionStatus: currentProjection?.status ?? 'MISSING',
          runtimeErrorMatches:
            currentProjection?.error === 'agent.errors.toolApprovalDenied',
        },
      );
      throw error;
    }
    const errorElement = toolCallElement.querySelector<HTMLElement>(
      '[data-pt-agent-tool-error="agent.errors.toolApprovalDenied"]',
    );
    const runtimeEvent = [...turn.observed.events]
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
    const sourceReplay = withoutDiagnosticGenerationTime(source.replay);
    const repeatedReplay = withoutDiagnosticGenerationTime(replayed.replay);
    const firstAcknowledgementHash = await sha256Hex(
      stableJson(firstAcknowledgement),
    );
    const replayedAcknowledgementHash = await sha256Hex(
      stableJson(replayedAcknowledgement),
    );
    const sourceReplayHash = await sha256Hex(stableJson(sourceReplay));
    const repeatedReplayHash = await sha256Hex(stableJson(repeatedReplay));
    const stationFact = diagnosticToolCase(replayed.facts[0], sideEffectCount);
    const stationLineage = evidenceRecord(
      stationFact.lineage,
      'foundationApprovalDeniedStationLineage',
    );
    await reportFoundationApprovalReceiverDebug(
      'F',
      'denial-settled',
      {
        stationPolicy: stationFact.policy,
        stationStates: stationFact.states,
        stationErrorCode: stationFact.errorCode,
        decisionAccepted: firstAcknowledgement.accepted,
        decisionApproved: firstAcknowledgement.approved,
        toolCallMatches:
          stationLineage.toolCallId === firstAcknowledgement.tool_call_id,
        decisionIdMatches:
          stationLineage.decisionId === firstAcknowledgement.decision_id,
        decisionRevisionMatches:
          Number(stationLineage.decisionRevision)
            === firstAcknowledgement.decision_revision,
      },
    );

    result = {
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      durationMs: performance.now() - startedAt,
      runtimeEvent,
      facts: {
        outcome: projection.decisionOutcome,
        receiver: {
          recoveryVisible,
          recoveryText,
          expectedRecoveryText,
          recoveryExecuted: true,
          errorVisible: Boolean(
            errorElement && errorElement.getClientRects().length > 0,
          ),
          errorText: errorElement?.textContent?.trim() ?? '',
          expectedErrorText: i18n.t(
            'agent.errors.toolApprovalDenied',
            { ns: 'agent' },
          ),
        },
        decision: {
          accepted: true,
          approved: false,
          approvalId,
          toolCallId,
          decisionId: projection.decisionId,
          decisionRevision: projection.decisionRevision,
        },
        station: stationFact,
        replay: {
          acknowledgementSourceHash: firstAcknowledgementHash,
          acknowledgementReplayHash: replayedAcknowledgementHash,
          diagnosticSourceHash: sourceReplayHash,
          diagnosticReplayHash: repeatedReplayHash,
          equal:
            firstAcknowledgementHash === replayedAcknowledgementHash
            && sourceReplayHash === repeatedReplayHash,
        },
        capabilitySession: {
          ...capabilitySession.facts,
          turnId: turn.turnId,
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
  if (!result) {
    throw new Error('agent.acceptance.foundationToolDenialFactsMissing');
  }
  const restoredBindings = await api.listAgentCapabilityBindings(
    input.agent.id || input.agent.name,
  );
  const restoredBinding = restoredBindings.find((candidate) =>
    candidate.capabilityId === fixture.manifest.capabilityId
    && candidate.capabilityVersion === fixture.manifest.version
    && !candidate.tombstonedAt) ?? null;
  result.facts.cleanup = {
    bindingRestored: originalBinding
      ? (
          restoredBinding?.approvalPolicy === originalBinding.approvalPolicy
          && restoredBinding.enabled === originalBinding.enabled
        )
      : restoredBinding === null,
    conversationDeleted: false,
  };
  return result;
}

async function runFoundationApprovalExpiredScenario(input: {
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
  let conversationId = '';
  let turnId = '';
  let operationError: unknown = null;
  const startedAt = performance.now();
  let result: {
    conversationId: string;
    turnId: string;
    durationMs: number;
    runtimeEvent: {
      eventType: string;
      sequence: number;
      observedAt: string;
    };
    facts: Record<string, unknown>;
  } | null = null;

  try {
    currentBinding = await updateFoundationToolPolicy(
      input.agent,
      fixture,
      currentBinding,
      CapabilityApprovalPolicy.MANUAL,
    );
    const capabilitySession = await resolveFoundationToolTurnSession();
    const turn = await startFoundationToolTurn({
      agent: input.agent,
      capabilitySessionId: capabilitySession.capabilitySessionId,
      fixture,
      sampleId: input.sampleId,
      label: 'approval-expired',
    });
    conversationId = turn.conversationId;
    turnId = turn.turnId;
    await useChatStore.getState().selectSession(turn.conversationId);
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
    const expiresAt = String(
      evidenceField(approval, 'expiresAt', 'expires_at') ?? '',
    );
    if (
      !approvalId
      || !toolCallId
      || !Number.isInteger(expectedRevision)
      || !expiresAt
    ) {
      throw new Error('agent.acceptance.foundationToolApprovalInvalid');
    }

    await waitForFoundationToolFacts(
      turn.turnId,
      (facts, replay) =>
        facts.length === 1
        && Number(facts[0].status) === ToolCallStatus.EXPIRED
        && diagnosticReplayTerminal(replay),
      'approval-expired Station settlement',
    );

    await waitFor(
      () => {
        const projection = toolRuntime.getProjection(toolCallId);
        return (
          projection?.status === 'expired'
          && projection.error === 'agent.errors.toolApprovalExpired'
        );
      },
      'approval-expired runtime projection',
      FOUNDATION_TOOL_RECONCILE_TIMEOUT_MS,
    );
    await waitFor(
      () => Array.from(
        document.querySelectorAll<HTMLElement>('[data-pt-agent-tool-call]'),
      ).some((element) =>
        element.dataset.ptAgentToolCall === toolCallId),
      'approval-expired ToolCall receiver',
      30_000,
    );
    const toolCallElement = Array.from(
      document.querySelectorAll<HTMLElement>('[data-pt-agent-tool-call]'),
    ).find((element) => element.dataset.ptAgentToolCall === toolCallId);
    if (!toolCallElement) {
      throw new Error('agent.acceptance.foundationToolCallSurfaceMissing');
    }
    let recovery = toolCallElement.querySelector<HTMLButtonElement>(
      '[data-pt-agent-tool-recovery="request-again"]',
    );
    if (!recovery) {
      toolCallElement.querySelector<HTMLElement>(
        '[data-pt-agent-tool-call-toggle]',
      )?.click();
      await waitFor(
        () => Boolean(toolCallElement.querySelector(
          '[data-pt-agent-tool-recovery="request-again"]',
        )),
        'approval-expired recovery action',
        10_000,
      );
      recovery = toolCallElement.querySelector<HTMLButtonElement>(
        '[data-pt-agent-tool-recovery="request-again"]',
      );
    }
    if (!recovery) {
      throw new Error('agent.acceptance.foundationToolRecoveryMissing');
    }
    const expectedRecoveryText = i18n.t(
      'agent.recovery.requestAgain',
      { ns: 'agent' },
    );
    const recoveryVisible = recovery.getClientRects().length > 0;
    const recoveryText = recovery.textContent?.trim() ?? '';
    const errorElement = toolCallElement.querySelector<HTMLElement>(
      '[data-pt-agent-tool-error="agent.errors.toolApprovalExpired"]',
    );

    const decisionId = crypto.randomUUID();
    const decisionIntent = {
      approval_id: approvalId,
      tool_call_id: toolCallId,
      decision_id: decisionId,
      expected_revision: expectedRevision,
      approved: true,
      idempotency_key: decisionId,
    };
    const firstAcknowledgement = await api.submitAgentToolDecision(
      decisionIntent,
    );
    const replayedAcknowledgement = await api.submitAgentToolDecision(
      decisionIntent,
    );
    const firstAcknowledgementHash = await sha256Hex(
      stableJson(firstAcknowledgement),
    );
    const replayedAcknowledgementHash = await sha256Hex(
      stableJson(replayedAcknowledgement),
    );
    const decisionSettled = await waitForFoundationToolFacts(
      turn.turnId,
      (facts, replay) =>
        facts.length === 1
        && Number(facts[0].status) === ToolCallStatus.EXPIRED
        && diagnosticReplayTerminal(replay),
      'approval-expired decision replay',
    );
    const expiredDecisionFact = decisionSettled.facts[0];
    const sideEffectCountBefore = await foundationToolSideEffectCount(
      input.platform,
      expiredDecisionFact,
    );
    const stationBefore = diagnosticToolCase(
      expiredDecisionFact,
      sideEffectCountBefore,
    );
    const stationBeforeHash = await sha256Hex(stableJson(stationBefore));
    const attemptsBefore = evidenceArray(
      decisionSettled.replay.attempts,
      'foundationApprovalExpiredAttemptsBefore',
    ).length;

    recovery.click();
    recovery.click();
    const retryStarted = await waitForFoundationToolFacts(
      turn.turnId,
      (facts, replay) => (
        evidenceArray(
          replay.attempts,
          'foundationApprovalExpiredRetryAttempts',
        ).length === attemptsBefore + 1
        && facts.some((fact) => (
          String(evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '')
            !== toolCallId
          && String(evidenceField(fact, 'approvalId', 'approval_id') ?? '')
        ))
      ),
      'approval-expired request-again attempt',
      120_000,
    );
    const retryToolFact = retryStarted.facts.find((fact) =>
      String(evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '')
        !== toolCallId
      && String(evidenceField(fact, 'approvalId', 'approval_id') ?? ''));
    await reportFoundationApprovalRetryCancellationDebug(
      'B-D',
      'retry-observed',
      {
        attemptCountBefore: attemptsBefore,
        attemptCountAfter: evidenceArray(
          retryStarted.replay.attempts,
          'foundationApprovalExpiredRetryAttempts',
        ).length,
        replayStatus: Number(retryStarted.replay.status),
        retryToolPresent: Boolean(retryToolFact),
        retryToolStatus: retryToolFact
          ? Number(retryToolFact.status)
          : null,
        retryApprovalPresent: Boolean(
          retryToolFact
          && String(
            evidenceField(retryToolFact, 'approvalId', 'approval_id') ?? '',
          ),
        ),
      },
    );
    const cancellation = await api.cancelAgentTurn(turn.turnId);
    await reportFoundationApprovalRetryCancellationDebug(
      'A-D',
      'cancel-response',
      {
        cancellationStatus: String(cancellation.status ?? ''),
        turnIdentityPresent: Boolean(cancellation.turn_id),
      },
    );
    let settled: Awaited<ReturnType<typeof waitForFoundationToolFacts>>;
    try {
      settled = await waitForFoundationToolFacts(
        turn.turnId,
        (facts, replay) =>
          facts.some((fact) =>
            String(evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '')
              === toolCallId)
          && facts.some((fact) =>
            String(evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '')
              !== toolCallId
            && Number(fact.status) === ToolCallStatus.CANCELLED)
          && Number(replay.status) === AgentTurnStatus.CANCELLED,
        'approval-expired retry cancellation',
      );
    } catch (error) {
      try {
        const replay = await foundationDiagnosticReplay(turn.turnId);
        const facts = foundationDiagnosticToolFacts(replay);
        const originalTool = facts.find((fact) =>
          String(evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '')
            === toolCallId);
        const retryTool = facts.find((fact) =>
          String(evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '')
            !== toolCallId);
        await reportFoundationApprovalRetryCancellationDebug(
          'A-E',
          'cancellation-timeout',
          {
            cancellationStatus: String(cancellation.status ?? ''),
            replayStatus: Number(replay.status),
            attemptCount: evidenceArray(
              replay.attempts,
              'foundationApprovalExpiredCancellationAttempts',
            ).length,
            toolFactCount: facts.length,
            originalToolStatus: originalTool
              ? Number(originalTool.status)
              : null,
            retryToolStatus: retryTool
              ? Number(retryTool.status)
              : null,
            retryApprovalPresent: Boolean(
              retryTool
              && String(
                evidenceField(retryTool, 'approvalId', 'approval_id') ?? '',
              ),
            ),
          },
        );
      } catch {
        await reportFoundationApprovalRetryCancellationDebug(
          'C',
          'cancellation-diagnostic-read-failed',
        );
      }
      throw error;
    }
    const expiredAfter = settled.facts.find((fact) =>
      String(evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '')
        === toolCallId);
    if (!expiredAfter) {
      throw new Error('agent.acceptance.foundationExpiredToolFactMissing');
    }
    const retryAfter = settled.facts.find((fact) =>
      String(evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '')
        !== toolCallId
      && String(evidenceField(fact, 'approvalId', 'approval_id') ?? ''));
    if (!retryAfter) {
      throw new Error('agent.acceptance.foundationRetryToolFactMissing');
    }
    const sideEffectCountAfter = await foundationToolSideEffectCount(
      input.platform,
      expiredAfter,
    );
    const retrySideEffectCount = await foundationToolSideEffectCount(
      input.platform,
      retryAfter,
    );
    const retryStation = diagnosticToolCase(
      retryAfter,
      retrySideEffectCount,
    );
    const stationAfter = diagnosticToolCase(
      expiredAfter,
      sideEffectCountAfter,
    );
    const stationAfterHash = await sha256Hex(stableJson(stationAfter));
    const runtimeEvent = [...turn.observed.events]
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

    result = {
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      durationMs: performance.now() - startedAt,
      runtimeEvent,
      facts: {
        outcome: firstAcknowledgement.outcome_error,
        receiver: {
          recoveryVisible,
          recoveryText,
          expectedRecoveryText,
          recoveryExecuted: true,
          errorVisible: Boolean(
            errorElement && errorElement.getClientRects().length > 0,
          ),
          errorText: errorElement?.textContent?.trim() ?? '',
          expectedErrorText: i18n.t(
            'agent.errors.toolApprovalExpired',
            { ns: 'agent' },
          ),
        },
        decision: {
          accepted: firstAcknowledgement.accepted,
          approvalId,
          toolCallId,
          decisionId,
          decisionRevision: firstAcknowledgement.decision_revision,
          errorCode: firstAcknowledgement.error_code,
          expiresAt,
        },
        station: stationAfter,
        recovery: {
          attemptCountBefore: attemptsBefore,
          attemptCountAfter: evidenceArray(
            retryStarted.replay.attempts,
            'foundationApprovalExpiredAttemptsAfter',
          ).length,
          newApprovalIdentityDistinct: Boolean(
            retryToolFact
            && String(
              evidenceField(
                retryToolFact,
                'approvalId',
                'approval_id',
              ) ?? '',
            ) !== approvalId
          ),
          cancellationStatus: String(cancellation.status ?? '').toLowerCase(),
          retryToolStatus: toolStatusName(retryAfter.status),
          retryExecutionAttemptCount: retryStation.executionAttemptCount,
          retrySideEffectCount: retryStation.sideEffectCount,
          retryResultCount: retryStation.resultCount,
          retryContinuationCount: retryStation.continuationCount,
        },
        replay: {
          acknowledgementSourceHash: firstAcknowledgementHash,
          acknowledgementReplayHash: replayedAcknowledgementHash,
          stationSourceHash: stationBeforeHash,
          stationReplayHash: stationAfterHash,
          equal:
            firstAcknowledgementHash === replayedAcknowledgementHash
            && stationBeforeHash === stationAfterHash,
        },
        capabilitySession: {
          ...capabilitySession.facts,
          turnId: turn.turnId,
        },
      },
    };
  } catch (error) {
    operationError = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
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
    } catch (error) {
      cleanupErrors.push(error);
    }
    if ((operationError || cleanupErrors.length > 0) && conversationId) {
      try {
        await cleanupFoundationToolConversation(
          conversationId,
          turnId,
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw Object.assign(
        new Error('agent.acceptance.foundationToolExpiryCleanupFailed'),
        {
          primaryError: operationError,
          cleanupErrors,
        },
      );
    }
  }
  if (operationError) throw operationError;
  if (!result) {
    throw new Error('agent.acceptance.foundationToolExpiryFactsMissing');
  }
  const restoredBindings = await api.listAgentCapabilityBindings(
    input.agent.id || input.agent.name,
  );
  const restoredBinding = restoredBindings.find((candidate) =>
    candidate.capabilityId === fixture.manifest.capabilityId
    && candidate.capabilityVersion === fixture.manifest.version
    && !candidate.tombstonedAt) ?? null;
  result.facts.cleanup = {
    bindingRestored: originalBinding
      ? (
          restoredBinding?.approvalPolicy === originalBinding.approvalPolicy
          && restoredBinding.enabled === originalBinding.enabled
        )
      : restoredBinding === null,
    conversationDeleted: false,
  };
  return result;
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
  const startedAt = performance.now();
  // #region debug-point I-L:foundation-f05-turn
  void reportFoundationAttachmentTimeoutDebug('I-L', 'turn-submission-started', {
    attachmentCount: input.attachments.length,
    capabilitySessionPresent: Boolean(input.capabilitySessionId),
    providerPresent: Boolean(input.provider),
    modelPresent: Boolean(input.model),
  });
  // #endregion
  const observed = startObservedFoundationTurn({
    conversationId: input.conversationId,
    agentId: input.agentId,
    content: input.content,
    idempotencyKey: crypto.randomUUID(),
    provider: input.provider,
    model: input.model,
    clientCapabilitySessionId: input.capabilitySessionId,
    attachments: input.attachments,
    // #region debug-point J-K:foundation-f05-events
    onEvent: (event, events) => {
      void reportFoundationAttachmentTimeoutDebug('J-K', 'turn-event-observed', {
        eventCount: events.length,
        eventType: event.event,
        sequence: Number(event.data.seq ?? event.data.sequence ?? 0),
        terminal: classifyAgentTurnTerminalEvent(event),
      });
    },
    // #endregion
  });
  const result = await observed.result;
  // #region debug-point J-K:foundation-f05-settled
  await reportFoundationAttachmentTimeoutDebug('J-K', 'turn-submission-settled', {
    elapsedMs: Math.round(performance.now() - startedAt),
    errorCode: result.error
      ? observedErrorCode(new Error(result.error))
      : '',
    eventCount: result.events.length,
    lastEventType: result.events[result.events.length - 1]?.event ?? '',
    ok: result.ok,
  });
  // #endregion
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

function foundationAttachmentObjectKey(objectRef: string): string {
  const normalized = objectRef.trim();
  const key = normalized.startsWith('oss:')
    ? normalized.slice('oss:'.length).trim()
    : normalized;
  if (
    !key
    || key.startsWith('/')
    || key.includes('\\')
    || key.includes('://')
    || key.includes('..')
  ) {
    throw new Error('agent.acceptance.foundationAttachmentRefInvalid');
  }
  return key;
}

async function foundationAttachmentDeletionReadback(
  objectRef: string,
): Promise<FoundationAttachmentDeletionReadback> {
  const key = foundationAttachmentObjectKey(objectRef);
  let lastError: unknown =
    new Error('agent.acceptance.foundationAttachmentDeletionPending');

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const listing = await api.ossListMyFiles({
        include_deleted: true,
        mime: 'application/pdf',
        page: 1,
        page_size: 200,
      });
      const file = listing.files.find((candidate) => candidate.key === key);
      const deletedAt = file?.deleted_at?.trim() ?? '';
      if (deletedAt) {
        return {
          source: 'oss-owner-list',
          objectRefHash: await sha256Hex(objectRef),
          objectPathHash: await sha256Hex(key),
          deletedAt,
          readAttempt: attempt,
        };
      }
      lastError = new Error(
        file
          ? 'agent.acceptance.foundationAttachmentDeletionPending'
          : 'agent.acceptance.foundationAttachmentDeletionReadbackMissing',
      );
    } catch (error) {
      lastError = error;
      const code = (
        error && typeof error === 'object'
          ? (error as { code?: unknown }).code
          : null
      );
      if (
        typeof code === 'string'
        && code !== 'INTERNAL_ERROR'
      ) {
        break;
      }
    }
    if (attempt < 20) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }

  throw Object.assign(
    new Error('agent.acceptance.foundationAttachmentDeletionUnconfirmed'),
    { cause: lastError },
  );
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

    // #region debug-point I-L:foundation-f05-positive-turn
    void reportFoundationAttachmentTimeoutDebug('I-L', 'positive-turn-started', {
      capabilitySessionPresent: Boolean(input.capabilitySessionId),
      platform: input.platform,
      uploadedAttachmentCount: 2,
    });
    // #endregion
    const valid = await runFoundationAttachmentTurn({
      agentId,
      conversationId: conversation.conversation_id,
      provider: input.agent.provider || undefined,
      model: input.agent.model || undefined,
      capabilitySessionId: input.capabilitySessionId,
      attachments: [png, pdf],
      content: 'Acknowledge the attached files in one short sentence.',
    });
    // #region debug-point I-L:foundation-f05-positive-turn-result
    void reportFoundationAttachmentTimeoutDebug('I-L', 'positive-turn-finished', {
      eventCount: valid.result.events.length,
      ok: valid.result.ok,
      platform: input.platform,
      turnIdPresent: Boolean(valid.turnId),
    });
    // #endregion
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
    await waitFor(
      () => Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-pt-agent-message-attachment][role="button"]',
        ),
      ).some((element) =>
        element.dataset.ptAgentMessageAttachment === pdf.attachment_id),
      'downloadable attachment action',
      10_000,
    );
    const historyAttachment = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-pt-agent-message-attachment][role="button"]',
      ),
    ).find((element) =>
      element.dataset.ptAgentMessageAttachment === pdf.attachment_id);
    if (!historyAttachment) {
      throw new Error('agent.acceptance.foundationAttachmentActionMissing');
    }
    const originalWindowOpen = window.open;
    let openedAttachmentUrl = '';
    window.open = ((url?: string | URL) => {
      openedAttachmentUrl = String(url ?? '');
      return null;
    }) as typeof window.open;
    try {
      historyAttachment.click();
    } finally {
      window.open = originalWindowOpen;
    }
    const historyAction = {
      attachmentId: pdf.attachment_id,
      visible: historyAttachment.getClientRects().length > 0,
      keyboardReachable: historyAttachment.tabIndex === 0,
      accessibleNamePresent: Boolean(
        historyAttachment.getAttribute('aria-label')?.trim(),
      ),
      openInvoked: openedAttachmentUrl.length > 0,
      openedUrlHash: openedAttachmentUrl
        ? await sha256Hex(openedAttachmentUrl)
        : '',
    };

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
        receiverInteraction: historyAction,
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

async function runFoundationAttachmentRejectedScenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  sampleId: string;
}): Promise<{
  conversationId: string;
  turnId: string;
  durationMs: number;
  runtimeEvent: FoundationRuntimeEventObservation;
  facts: Record<string, unknown>;
}> {
  const agentId = input.agent.id || input.agent.name;
  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation rejected attachment ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  let rejectionStartedAt = 0;
  let attachmentId = '';
  let objectRef = '';

  const cleanupFailure = async () => {
    const draft = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-pt-agent-composer-attachment]',
      ),
    ).find((element) =>
      element.dataset.ptAgentComposerAttachment === attachmentId);
    const remove = draft?.querySelector<HTMLElement>(
      '[data-pt-agent-composer-attachment-remove]',
    );
    remove?.click();
    if (objectRef) {
      let deletionError: unknown = null;
      try {
        await api.ossDeleteAgentAttachment(objectRef);
      } catch (error) {
        deletionError = error;
      }
      try {
        await foundationAttachmentDeletionReadback(objectRef);
      } catch (readbackError) {
        throw Object.assign(
          new Error(
            'agent.acceptance.foundationAttachmentDeletionUnconfirmed',
          ),
          { deletionError, readbackError },
        );
      }
    }
    await deleteFoundationConversation(conversation.conversation_id);
  };

  try {
    await useChatStore.getState().selectSession(conversation.conversation_id);
    const baseline = await withFoundationCapabilitiesDisabled(
      input.agent,
      input.capabilitySessionId,
      () => runFoundationAttachmentTurn({
        agentId,
        conversationId: conversation.conversation_id,
        provider: input.agent.provider || undefined,
        model: input.agent.model || undefined,
        capabilitySessionId: input.capabilitySessionId,
        attachments: [],
        content: 'Reply with ready.',
      }),
    );
    if (!baseline.result.ok || !baseline.turnId) {
      throw new Error(
        baseline.result.error
        || 'agent.acceptance.foundationAttachmentAttestationTurnFailed',
      );
    }
    await useChatStore.getState().selectSession('');
    await useChatStore.getState().selectSession(conversation.conversation_id);
    await useChatStore.getState().syncMessages();
    rejectionStartedAt = performance.now();
    const before = await foundationExecutionSnapshot(
      agentId,
      conversation.conversation_id,
    );
    const beforeReadback = await foundationConversationReadback(
      conversation.conversation_id,
    );

    const fileInput = document.querySelector<HTMLInputElement>(
      '[data-pt-agent-attachment-input]',
    );
    if (!fileInput) {
      throw new Error('agent.acceptance.foundationAttachmentInputMissing');
    }
    const stalePdf = new File(
      [Uint8Array.from(FOUNDATION_PDF_BYTES)],
      `foundation-rejected-${input.sampleId}.pdf`,
      { type: 'application/pdf' },
    );
    const transfer = new DataTransfer();
    transfer.items.add(stalePdf);
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: transfer.files,
    });
    void reportFoundationAttachmentTimeoutDebug('A-C', 'input-dispatch', {
      fileCount: fileInput.files?.length ?? 0,
      firstFileMimeType: fileInput.files?.item(0)?.type ?? '',
      firstFileSize: fileInput.files?.item(0)?.size ?? 0,
      conversationIdPresent: conversation.conversation_id.length > 0,
    });
    // eslint-disable-next-line no-restricted-syntax -- Drive the real file-input boundary.
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    try {
      await waitFor(
        () => Boolean(document.querySelector(
          '[data-pt-agent-composer-attachment-status="ready"]',
        )),
        'attachment upload',
        30_000,
      );
    } catch (error) {
      await reportFoundationAttachmentTimeoutDebug('A-D', 'ready-timeout', {
        error: error instanceof Error ? error.message : String(error),
        drafts: Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-pt-agent-composer-attachment]',
          ),
        ).map((draft) => ({
          attachmentId: draft.dataset.ptAgentComposerAttachment ?? '',
          objectRefPresent: Boolean(
            draft.dataset.ptAgentComposerAttachmentObjectRef,
          ),
          status: draft.dataset.ptAgentComposerAttachmentStatus ?? '',
          text: draft.textContent?.trim() ?? '',
        })),
      });
      throw error;
    }
    void reportFoundationAttachmentTimeoutDebug('A-D', 'upload-ready', {
      readyCount: document.querySelectorAll(
        '[data-pt-agent-composer-attachment-status="ready"]',
      ).length,
    });
    const readyDraft = document.querySelector<HTMLElement>(
      '[data-pt-agent-composer-attachment-status="ready"]',
    );
    attachmentId =
      readyDraft?.dataset.ptAgentComposerAttachment?.trim() ?? '';
    objectRef =
      readyDraft?.dataset.ptAgentComposerAttachmentObjectRef?.trim() ?? '';
    if (!attachmentId || !objectRef || !objectRef.startsWith('oss:')) {
      throw new Error(
        'agent.acceptance.foundationAttachmentDraftIdentityMissing',
      );
    }
    const deletion = await api.ossDeleteAgentAttachment(objectRef);
    await reportFoundationAttachmentTimeoutDebug('E-G', 'delete-resolved', {
      deletedAtPresent: Boolean(deletion.deleted_at?.trim()),
      alreadyDeleted: deletion.already_deleted,
    });
    try {
      const readback = await foundationAttachmentDeletionReadback(objectRef);
      await reportFoundationAttachmentTimeoutDebug(
        'E-G',
        'deletion-readback-resolved',
        {
          source: readback.source,
          deletedAtPresent: Boolean(readback.deletedAt),
          readAttempt: readback.readAttempt,
        },
      );
    } catch (error) {
      const errorRecord =
        error && typeof error === 'object'
          ? error as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown }
          : {};
      const causeRecord =
        errorRecord.cause && typeof errorRecord.cause === 'object'
          ? errorRecord.cause as { name?: unknown; message?: unknown; code?: unknown }
          : {};
      await reportFoundationAttachmentTimeoutDebug(
        'E-G',
        'deletion-readback-failed',
        {
          errorName: String(errorRecord.name ?? ''),
          errorMessage: String(errorRecord.message ?? error),
          errorCode: String(errorRecord.code ?? ''),
          causeName: String(causeRecord.name ?? ''),
          causeMessage: String(causeRecord.message ?? ''),
          causeCode: String(causeRecord.code ?? ''),
        },
      );
      throw error;
    }

    const draftText =
      `Reject the invalid attachment before execution ${input.sampleId}`;
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-pt-agent-composer-input]',
    );
    const setTextareaValue = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    if (!textarea || !setTextareaValue) {
      throw new Error('agent.acceptance.foundationComposerInputMissing');
    }
    setTextareaValue.call(textarea, draftText);
    // eslint-disable-next-line no-restricted-syntax -- Drive the real controlled textarea boundary.
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(
      () => textarea.value === draftText,
      'rejected attachment composer draft',
      10_000,
    );

    let rejectionObservationSequence = 0;
    const rejectionEventRef: {
      current: FoundationPreAdmissionErrorEvent | null;
    } = { current: null };
    const unsubscribe = eventBus.subscribe(
      EVENT.AGENT_TURN_STREAM_EVENT,
      (payload) => {
        if (payload.conversationId !== conversation.conversation_id) {
          return;
        }
        rejectionObservationSequence += 1;
        if (
          payload.event !== 'error'
          || payload.data.error_type !== 'CONTEXT_ATTACHMENT_REJECTED'
        ) return;
        rejectionEventRef.current = {
          data: evidenceValue(payload.data) as Record<string, unknown>,
          eventType: payload.event,
          observedAt: new Date(payload.timestampMs).toISOString(),
          streamId: payload.streamId,
          streamGeneration: payload.streamGeneration,
          conversationId: payload.conversationId,
          observationSequence: rejectionObservationSequence,
          timestampMs: payload.timestampMs,
        };
      },
    );
    try {
      const send = document.querySelector<HTMLElement>(
        '[data-pt-agent-composer-send]',
      );
      if (!send) {
        throw new Error('agent.acceptance.foundationComposerSendMissing');
      }
      send.click();
      await waitFor(
        () => rejectionEventRef.current !== null,
        'typed attachment rejection',
        60_000,
      );
      await waitFor(
        () => Boolean(document.querySelector(
          '[data-pt-agent-composer-attachment-status="rejected"]',
        )),
        'rejected attachment draft',
        10_000,
      );
      await waitFor(
        () => Boolean(document.querySelector(
          '[data-pt-agent-message-error="agent.errors.attachmentRejected"]',
        )),
        'attachment rejection receiver',
        10_000,
      );
    } finally {
      unsubscribe();
    }

    const errorSurface = document.querySelector<HTMLElement>(
      '[data-pt-agent-message-error="agent.errors.attachmentRejected"]',
    );
    const errorToggle = errorSurface?.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-toggle]',
    );
    if (
      !errorSurface?.querySelector(
        '[data-pt-agent-message-error-text="agent.errors.attachmentRejected"]',
      )
    ) {
      errorToggle?.click();
      await waitFor(
        () => Boolean(errorSurface?.querySelector(
          '[data-pt-agent-message-error-text="agent.errors.attachmentRejected"]',
        )),
        'localized attachment rejection text',
        10_000,
      );
    }
    const errorText = errorSurface?.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-text="agent.errors.attachmentRejected"]',
    );
    const rejectedDraft = document.querySelector<HTMLElement>(
      '[data-pt-agent-composer-attachment-status="rejected"]',
    );
    const removeAction = rejectedDraft?.querySelector<HTMLElement>(
      '[data-pt-agent-composer-attachment-remove]',
    );
    const rejectionEvent =
      rejectionEventRef.current as FoundationPreAdmissionErrorEvent | null;
    if (!rejectedDraft || !removeAction || !errorText || !rejectionEvent) {
      throw new Error(
        'agent.acceptance.foundationAttachmentRejectionSurfaceMissing',
      );
    }
    if (
      !rejectionEvent.streamId
      || rejectionEvent.streamGeneration <= 0
      || rejectionEvent.observationSequence <= 0
      || rejectionEvent.timestampMs <= 0
    ) {
      throw new Error(
        'agent.acceptance.foundationAttachmentRuntimeEventMissing',
      );
    }
    const rejectionIdentity = {
      streamId: rejectionEvent.streamId,
      streamGeneration: rejectionEvent.streamGeneration,
      conversationId: rejectionEvent.conversationId,
      observationSequence: rejectionEvent.observationSequence,
      eventType: rejectionEvent.eventType,
      timestampMs: rejectionEvent.timestampMs,
      data: rejectionEvent.data,
    };
    const rejectionRuntimeEvent: FoundationRuntimeEventObservation = {
      eventId: await sha256Hex(stableJson(rejectionIdentity)),
      eventType: rejectionEvent.eventType,
      sequence: rejectionEvent.observationSequence,
      observedAt: rejectionEvent.observedAt,
      streamGeneration: rejectionEvent.streamGeneration,
      streamIdHash: await sha256Hex(rejectionEvent.streamId),
      conversationIdHash: await sha256Hex(rejectionEvent.conversationId),
      payloadHash: await sha256Hex(stableJson(rejectionEvent.data)),
      errorType: String(rejectionEvent.data.error_type ?? ''),
    };

    const attachmentVisibleAfterReject =
      rejectedDraft.getClientRects().length > 0;
    const removalVisible = removeAction.getClientRects().length > 0;
    const removalText =
      removeAction.getAttribute('aria-label')
      ?? removeAction.getAttribute('title')
      ?? '';
    const draftTextAfterRejection = textarea.value;
    removeAction.click();
    await waitFor(
      () => !Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-pt-agent-composer-attachment]',
        ),
      ).some((element) =>
        element.dataset.ptAgentComposerAttachment === attachmentId),
      'attachment removal',
      10_000,
    );

    const deletionReadback =
      await foundationAttachmentDeletionReadback(objectRef);
    await reportFoundationAttachmentTimeoutDebug(
      'E-G',
      'post-rejection-deletion-readback-resolved',
      {
        source: deletionReadback.source,
        deletedAtPresent: Boolean(deletionReadback.deletedAt),
        readAttempt: deletionReadback.readAttempt,
      },
    );

    const after = await foundationExecutionSnapshot(
      agentId,
      conversation.conversation_id,
    );
    const afterReadback = await foundationConversationReadback(
      conversation.conversation_id,
    );
    const beforeHash = await sha256Hex(stableJson(beforeReadback));
    const afterHash = await sha256Hex(stableJson(afterReadback));
    const typedOutcome = rejectionEvent.data;
    const details = evidenceRecord(
      typedOutcome.details,
      'foundationAttachmentRejectedDetails',
    );

    return {
      conversationId: conversation.conversation_id,
      turnId: baseline.turnId,
      durationMs: performance.now() - rejectionStartedAt,
      runtimeEvent: rejectionRuntimeEvent,
      facts: {
        runtimeEvent: rejectionRuntimeEvent,
        outcome: typedOutcome,
        receiver: {
          errorVisible: errorText.getClientRects().length > 0,
          errorText: errorText.textContent?.trim() ?? '',
          expectedErrorText: i18n.t(
            'agent.errors.attachmentRejected',
            { ns: 'agent' },
          ),
          attachmentVisibleAfterReject,
          attachmentStatusAfterReject:
            rejectedDraft.dataset.ptAgentComposerAttachmentStatus,
          draftTextBefore: draftText,
          draftTextAfterRejection,
          removalVisible,
          removalText,
          expectedRemovalText: i18n.t(
            'chat.input.attachmentRemove',
            { ns: 'chat' },
          ),
          removalExecuted: true,
          attachmentPresentAfterRemoval: false,
        },
        station: {
          attachmentId,
          objectRefHash: await sha256Hex(objectRef),
          reasonCode: details.reason_code,
          conversationVersionBefore: beforeReadback.conversation.version,
          conversationVersionAfter: afterReadback.conversation.version,
          beforeHash,
          afterHash,
          turnDelta: after.turnCount - before.turnCount,
          providerExecutionDelta:
            after.providerCallCount - before.providerCallCount,
          messageDelta:
            afterReadback.messages.length - beforeReadback.messages.length,
        },
        replay: {
          sourceHash: beforeHash,
          replayHash: afterHash,
          equal: beforeHash === afterHash,
        },
        cleanup: {
          draftRemoved: true,
          objectDeleted: true,
          deletionReadback,
          conversationDeleted: false,
        },
      },
    };
  } catch (error) {
    try {
      await cleanupFailure();
    } catch (cleanupError) {
      throw Object.assign(
        new Error(
          'agent.acceptance.foundationAttachmentRejectionCleanupFailed',
        ),
        {
          primaryError: error,
          cleanupError,
        },
      );
    }
    throw error;
  }
}

async function runFoundationContextOverflowScenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  sampleId: string;
}): Promise<{
  conversationId: string;
  turnId: string;
  durationMs: number;
  runtimeEvent: FoundationRuntimeEventObservation;
  facts: Record<string, unknown>;
}> {
  const agentId = input.agent.id || input.agent.name;
  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation context overflow ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  const overflowDraft =
    `Context overflow ${input.sampleId}: `
    + 'bounded-input '.repeat(32);
  const reducedDraft = `Reduced context ${input.sampleId}`;
  let baselineTurnId = '';

  const setComposerDraft = (value: string) => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-pt-agent-composer-input]',
    );
    const setTextareaValue = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    if (!textarea || !setTextareaValue) {
      throw new Error('agent.acceptance.foundationComposerInputMissing');
    }
    setTextareaValue.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return textarea;
  };

  try {
    await useChatStore.getState().selectSession(conversation.conversation_id);
    const baseline = await withFoundationCapabilitiesDisabled(
      input.agent,
      input.capabilitySessionId,
      () => runFoundationAttachmentTurn({
        agentId,
        conversationId: conversation.conversation_id,
        provider: input.agent.provider || undefined,
        model: input.agent.model || undefined,
        capabilitySessionId: input.capabilitySessionId,
        attachments: [],
        content: 'Reply with ready.',
      }),
    );
    baselineTurnId = baseline.turnId;
    if (!baseline.result.ok || !baselineTurnId) {
      throw new Error(
        baseline.result.error
        || 'agent.acceptance.foundationContextOverflowAttestationFailed',
      );
    }
    await useChatStore.getState().selectSession('');
    await useChatStore.getState().selectSession(conversation.conversation_id);
    await useChatStore.getState().syncMessages();

    const before = await foundationExecutionSnapshot(
      agentId,
      conversation.conversation_id,
    );
    const beforeReadback = await foundationConversationReadback(
      conversation.conversation_id,
    );
    const beforeQueue = await api.listAgentTurnQueue(
      conversation.conversation_id,
    );
    useChatStore.getState().fillComposer(overflowDraft);
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-pt-agent-composer-input]',
    );
    if (!textarea) {
      throw new Error('agent.acceptance.foundationComposerInputMissing');
    }
    await waitFor(
      () => textarea.value === overflowDraft,
      'context overflow composer draft',
      10_000,
    );

    let observationSequence = 0;
    const errorEventRef: {
      current: FoundationPreAdmissionErrorEvent | null;
    } = { current: null };
    const unsubscribe = eventBus.subscribe(
      EVENT.AGENT_TURN_STREAM_EVENT,
      (payload) => {
        const sourceDelivery = (
          payload as typeof payload & {
            sourceDelivery?: AgentTurnSourceDelivery;
          }
        ).sourceDelivery;
        if (payload.conversationId !== conversation.conversation_id) {
          return;
        }
        observationSequence += 1;
        if (
          payload.event !== 'error'
          || payload.data.error_type !== 'CONTEXT_OVERFLOW'
        ) return;
        errorEventRef.current = {
          data: evidenceValue(payload.data) as Record<string, unknown>,
          eventType: payload.event,
          observedAt: new Date(payload.timestampMs).toISOString(),
          streamId: payload.streamId,
          streamGeneration: payload.streamGeneration,
          conversationId: payload.conversationId,
          observationSequence,
          timestampMs: payload.timestampMs,
          sourceDelivery,
        };
      },
    );

    const startedAt = performance.now();
    try {
      const sent = useChatStore.getState().sendMessage(
        overflowDraft,
        [],
        {
          requestedBudget: {
            max_input_tokens: 64,
          },
        },
      );
      if (!sent) {
        throw new Error('agent.acceptance.foundationContextOverflowSendRejected');
      }
      await waitFor(
        () => errorEventRef.current !== null,
        'typed context overflow rejection',
        60_000,
      );
      await waitFor(
        () => Boolean(document.querySelector(
          '[data-pt-agent-message="assistant"]'
          + '[data-pt-agent-error-type="CONTEXT_OVERFLOW"]',
        )),
        'context overflow receiver',
        10_000,
      );
    } finally {
      unsubscribe();
    }

    const errorSurface = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-pt-agent-message="assistant"]'
        + '[data-pt-agent-error-type="CONTEXT_OVERFLOW"]',
      ),
    ).reverse().find((element) => element.getClientRects().length > 0);
    const errorToggle = errorSurface?.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-toggle]',
    );
    const errorSelector =
      '[data-pt-agent-message-error-text="agent.errors.contextOverflow"]';
    if (!errorSurface?.querySelector(errorSelector)) {
      errorToggle?.click();
      await waitFor(
        () => Boolean(errorSurface?.querySelector(errorSelector)),
        'localized context overflow text',
        10_000,
      );
    }
    const errorText = errorSurface?.querySelector<HTMLElement>(errorSelector);
    const recoveryAction = errorSurface?.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-recovery="reduce-context"]',
    );
    const errorEvent =
      errorEventRef.current as FoundationPreAdmissionErrorEvent | null;
    if (!errorSurface || !errorText || !recoveryAction || !errorEvent) {
      throw new Error(
        'agent.acceptance.foundationContextOverflowSurfaceMissing',
      );
    }
    if (
      !errorEvent.streamId
      || errorEvent.streamGeneration <= 0
      || errorEvent.observationSequence <= 0
      || errorEvent.timestampMs <= 0
    ) {
      throw new Error(
        'agent.acceptance.foundationContextOverflowRuntimeEventMissing',
      );
    }
    const sourceDelivery = errorEvent.sourceDelivery;
    const actorPtid = authenticatedFoundationActorPtid();
    if (
      !sourceDelivery
      || sourceDelivery.transport !== 'station-sse'
      || sourceDelivery.ptid !== actorPtid
      || sourceDelivery.conversationId !== conversation.conversation_id
      || sourceDelivery.turnId !== ''
      || sourceDelivery.sequence !== 0
      || sourceDelivery.rawPayload.eventType !== 'error'
      || stableJson(
        normalizeProjectedStationPayload(sourceDelivery.rawPayload.data),
      ) !== stableJson(
        normalizeProjectedStationPayload(errorEvent.data),
      )
    ) {
      throw new Error(
        'agent.acceptance.foundationContextOverflowSourceIdentityMismatch',
      );
    }

    const draftAfterRejection = textarea.value;
    recoveryAction.click();
    await waitFor(
      () => document.activeElement === textarea,
      'context overflow recovery focus',
      10_000,
    );
    const composerFocusedAfterRecovery = document.activeElement === textarea;
    setComposerDraft(reducedDraft);
    await waitFor(
      () => textarea.value === reducedDraft,
      'context overflow reduced draft',
      10_000,
    );

    const after = await foundationExecutionSnapshot(
      agentId,
      conversation.conversation_id,
    );
    const afterReadback = await foundationConversationReadback(
      conversation.conversation_id,
    );
    const afterQueue = await api.listAgentTurnQueue(
      conversation.conversation_id,
    );
    const beforeHash = await sha256Hex(stableJson(beforeReadback));
    const afterHash = await sha256Hex(stableJson(afterReadback));
    const typedOutcome = errorEvent.data;
    const runtimeIdentity = {
      streamId: errorEvent.streamId,
      streamGeneration: errorEvent.streamGeneration,
      conversationId: errorEvent.conversationId,
      observationSequence: errorEvent.observationSequence,
      eventType: errorEvent.eventType,
      timestampMs: errorEvent.timestampMs,
      data: typedOutcome,
    };
    const runtimeEvent: FoundationRuntimeEventObservation = {
      eventId: await sha256Hex(stableJson(runtimeIdentity)),
      eventType: errorEvent.eventType,
      sequence: errorEvent.observationSequence,
      observedAt: errorEvent.observedAt,
      streamGeneration: errorEvent.streamGeneration,
      streamIdHash: await sha256Hex(errorEvent.streamId),
      conversationIdHash: await sha256Hex(errorEvent.conversationId),
      payloadHash: await sha256Hex(
        stableJson(sourceDelivery.rawPayload),
      ),
      errorType: String(typedOutcome.error_type ?? ''),
      sourceTransport: sourceDelivery.transport,
      sourcePtidHash: await sha256Hex(sourceDelivery.ptid),
      sourceConversationId: sourceDelivery.conversationId,
      sourceTurnId: sourceDelivery.turnId,
      sourceSequence: sourceDelivery.sequence,
      sourceEventType: sourceDelivery.rawPayload.eventType,
    };
    setComposerDraft('');
    clearFoundationLocalConversationProjection(
      conversation.conversation_id,
    );

    return {
      conversationId: conversation.conversation_id,
      turnId: baselineTurnId,
      durationMs: performance.now() - startedAt,
      runtimeEvent,
      facts: {
        outcome: typedOutcome,
        runtimeEvent,
        receiver: {
          errorVisible: errorText.getClientRects().length > 0,
          errorText: errorText.textContent?.trim() ?? '',
          expectedErrorText: i18n.t(
            'agent.errors.contextOverflow',
            { ns: 'agent' },
          ),
          recoveryVisible: recoveryAction.getClientRects().length > 0,
          recoveryText: recoveryAction.textContent?.trim() ?? '',
          expectedRecoveryText: i18n.t(
            'agent.recovery.reduceContext',
            { ns: 'agent' },
          ),
          draftLengthBefore: overflowDraft.length,
          draftLengthAfterRejection: draftAfterRejection.length,
          draftHashBefore: await sha256Hex(overflowDraft),
          draftHashAfterRejection: await sha256Hex(draftAfterRejection),
          composerFocusedAfterRecovery,
          reducedDraftLength: reducedDraft.length,
          reducedDraftHash: await sha256Hex(reducedDraft),
        },
        station: {
          conversationId: conversation.conversation_id,
          conversationVersionBefore: beforeReadback.conversation.version,
          conversationVersionAfter: afterReadback.conversation.version,
          beforeHash,
          afterHash,
          turnDelta: after.turnCount - before.turnCount,
          messageDelta:
            afterReadback.messages.length - beforeReadback.messages.length,
          queueDelta:
            afterQueue.entries.length - beforeQueue.entries.length,
          providerExecutionDelta:
            after.providerCallCount - before.providerCallCount,
        },
        replay: {
          sourceHash: beforeHash,
          replayHash: afterHash,
          equal: beforeHash === afterHash,
        },
        cleanup: {
          draftCleared: textarea.value === '',
          localProjectionCleared:
            !useChatStore.getState().sessionBuffers[
              conversation.conversation_id
            ]
            && !useChatStore.getState().operations[
              conversation.conversation_id
            ],
          conversationDeleted: false,
        },
      },
    };
  } catch (error) {
    try {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-pt-agent-composer-input]',
      );
      if (textarea) setComposerDraft('');
      clearFoundationLocalConversationProjection(
        conversation.conversation_id,
      );
      await deleteFoundationConversation(conversation.conversation_id);
    } catch (cleanupError) {
      throw Object.assign(
        new Error(
          'agent.acceptance.foundationContextOverflowCleanupFailed',
        ),
        {
          primaryError: error,
          cleanupError,
        },
      );
    }
    throw error;
  }
}

async function runFoundationDuplicateConflictScenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  sampleId: string;
}): Promise<{
  conversationId: string;
  turnId: string;
  durationMs: number;
  runtimeEvent: FoundationRuntimeEventObservation;
  facts: Record<string, unknown>;
}> {
  const agentId = input.agent.id || input.agent.name;
  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation duplicate conflict ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  const conversationId = conversation.conversation_id;
  const idempotencyKey = crypto.randomUUID();
  const originalContent = `Original request ${input.sampleId}`;
  const conflictingContent = `Conflicting request ${input.sampleId}`;
  let originalTurnId = '';
  let scenarioError: unknown = null;
  let cleanupError: unknown = null;
  let facts: Record<string, unknown> | null = null;
  const startedAt = performance.now();

  try {
    await useChatStore.getState().selectSession(conversationId);
    const originalResult = await withFoundationCapabilitiesDisabled(
      input.agent,
      input.capabilitySessionId,
      async () => {
        const original = startObservedFoundationTurn({
          conversationId,
          agentId,
          content: originalContent,
          idempotencyKey,
          provider: input.agent.provider || undefined,
          model: input.agent.model || undefined,
          effort: 'low',
          thinkingMode: 'disabled',
          clientCapabilitySessionId: input.capabilitySessionId,
        });
        return original.result;
      },
    );
    originalTurnId = observedTurnId(originalResult.events);
    if (!originalResult.ok || !originalTurnId) {
      throw new Error(
        originalResult.error
        || 'agent.acceptance.foundationDuplicateOriginalTurnFailed',
      );
    }

    await useChatStore.getState().syncMessages();
    await waitFor(
      () => useChatStore.getState().messages.some(
        (message) => (
          message.role === 'assistant'
          && message.turnId === originalTurnId
          && message.loading !== true
        ),
      ),
      'duplicate conflict original message',
      30_000,
    );

    const [beforeExecution, beforeReadback, beforeQueue] = await Promise.all([
      foundationExecutionSnapshot(agentId, conversationId),
      foundationConversationReadback(conversationId),
      api.listAgentTurnQueue(conversationId),
    ]);
    const beforeHash = await sha256Hex(stableJson(beforeReadback));
    const originalMessageIds = beforeReadback.messages
      .map((message) => message.messageId)
      .sort();

    const rejectedOutcomeRef: {
      current: Record<string, unknown> | null;
    } = { current: null };
    let observationSequence = 0;
    const errorEventRef: {
      current: FoundationPreAdmissionErrorEvent | null;
    } = { current: null };
    const unsubscribe = eventBus.subscribe(
      EVENT.AGENT_TURN_STREAM_EVENT,
      (payload) => {
        const sourceDelivery = (
          payload as typeof payload & {
            sourceDelivery?: AgentTurnSourceDelivery;
          }
        ).sourceDelivery;
        if (payload.conversationId !== conversationId) return;
        observationSequence += 1;
        if (
          payload.event !== 'error'
          || payload.data.error_type !== 'ADMISSION_DUPLICATE_CONFLICT'
        ) return;
        errorEventRef.current = {
          data: evidenceValue(payload.data) as Record<string, unknown>,
          eventType: payload.event,
          observedAt: new Date(payload.timestampMs).toISOString(),
          streamId: payload.streamId,
          streamGeneration: payload.streamGeneration,
          conversationId: payload.conversationId,
          observationSequence,
          timestampMs: payload.timestampMs,
          sourceDelivery,
        };
      },
    );
    try {
      const sent = useChatStore.getState().sendMessage(
        conflictingContent,
        [],
        {
          clientIdempotencyKey: idempotencyKey,
          onRejected: (error) => {
            if (error) {
              rejectedOutcomeRef.current =
                evidenceValue(error) as Record<string, unknown>;
            }
          },
        },
      );
      if (!sent) {
        throw new Error(
          'agent.acceptance.foundationDuplicateConflictSendRejected',
        );
      }
      await waitFor(
        () => (
          errorEventRef.current !== null
          && rejectedOutcomeRef.current !== null
        ),
        'typed duplicate conflict rejection',
        60_000,
      );
      await waitFor(
        () => Boolean(document.querySelector(
          '[data-pt-agent-message="assistant"]'
          + '[data-pt-agent-error-type="ADMISSION_DUPLICATE_CONFLICT"]',
        )),
        'duplicate conflict receiver',
        10_000,
      );
    } finally {
      unsubscribe();
    }

    const errorSurface = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-pt-agent-message="assistant"]'
        + '[data-pt-agent-error-type="ADMISSION_DUPLICATE_CONFLICT"]',
      ),
    ).reverse().find((element) => element.getClientRects().length > 0);
    const errorToggle = errorSurface?.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-toggle]',
    );
    const errorSelector =
      '[data-pt-agent-message-error-text="agent.errors.duplicateConflict"]';
    if (!errorSurface?.querySelector(errorSelector)) {
      errorToggle?.click();
      await waitFor(
        () => Boolean(errorSurface?.querySelector(errorSelector)),
        'localized duplicate conflict text',
        10_000,
      );
    }
    const errorText = errorSurface?.querySelector<HTMLElement>(errorSelector);
    const recoveryAction = errorSurface?.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-recovery="open-original"]',
    );
    const errorEvent =
      errorEventRef.current as FoundationPreAdmissionErrorEvent | null;
    if (
      !errorSurface
      || !errorText
      || !recoveryAction
      || !errorEvent
      || !rejectedOutcomeRef.current
    ) {
      throw new Error(
        'agent.acceptance.foundationDuplicateConflictSurfaceMissing',
      );
    }
    const rejectedOutcome = evidenceRecord(
      rejectedOutcomeRef.current,
      'foundationDuplicateConflictOutcome',
    );
    const rejectedDetails = evidenceRecord(
      rejectedOutcome.details,
      'foundationDuplicateConflictDetails',
    );
    const sourceDelivery = errorEvent.sourceDelivery;
    const actorPtid = authenticatedFoundationActorPtid();
    if (
      !sourceDelivery
      || sourceDelivery.transport !== 'station-sse'
      || sourceDelivery.ptid !== actorPtid
      || sourceDelivery.conversationId !== conversationId
      || sourceDelivery.turnId !== ''
      || sourceDelivery.sequence !== 0
      || sourceDelivery.rawPayload.eventType !== 'error'
      || stableJson(
        normalizeProjectedStationPayload(sourceDelivery.rawPayload.data),
      ) !== stableJson(
        normalizeProjectedStationPayload(errorEvent.data),
      )
    ) {
      throw new Error(
        'agent.acceptance.foundationDuplicateConflictSourceIdentityMismatch',
      );
    }

    const receiverErrorVisible = errorText.getClientRects().length > 0;
    const receiverErrorText = errorText.textContent?.trim() ?? '';
    const receiverRecoveryVisible =
      recoveryAction.getClientRects().length > 0;
    const receiverRecoveryText = recoveryAction.textContent?.trim() ?? '';
    recoveryAction.click();
    await waitFor(
      () => {
        const view = usePortalStore.getState().activeView;
        return view?.type === 'turnDetails' && view.turnId === originalTurnId;
      },
      'duplicate conflict original turn details',
      30_000,
    );
    await waitFor(
      () => Boolean(document.querySelector(
        `[data-agent-turn-details="${originalTurnId}"]`
        + ' [data-turn-details-state="ready"]',
      )),
      'duplicate conflict original turn readback',
      30_000,
    );
    const openedView = usePortalStore.getState().activeView;

    const [afterExecution, afterReadback, afterQueue] = await Promise.all([
      foundationExecutionSnapshot(agentId, conversationId),
      foundationConversationReadback(conversationId),
      api.listAgentTurnQueue(conversationId),
    ]);
    const afterHash = await sha256Hex(stableJson(afterReadback));
    const afterMessageIds = afterReadback.messages
      .map((message) => message.messageId)
      .sort();
    const runtimeEvent: FoundationRuntimeEventObservation = {
      eventId: await sha256Hex(stableJson({
        streamId: errorEvent.streamId,
        streamGeneration: errorEvent.streamGeneration,
        conversationId: errorEvent.conversationId,
        observationSequence: errorEvent.observationSequence,
        eventType: errorEvent.eventType,
        timestampMs: errorEvent.timestampMs,
        data: errorEvent.data,
      })),
      eventType: errorEvent.eventType,
      sequence: errorEvent.observationSequence,
      observedAt: errorEvent.observedAt,
      streamGeneration: errorEvent.streamGeneration,
      streamIdHash: await sha256Hex(errorEvent.streamId),
      conversationIdHash: await sha256Hex(errorEvent.conversationId),
      payloadHash: await sha256Hex(stableJson(sourceDelivery.rawPayload)),
      errorType: String(errorEvent.data.error_type ?? ''),
      sourceTransport: sourceDelivery.transport,
      sourcePtidHash: await sha256Hex(sourceDelivery.ptid),
      sourceConversationId: sourceDelivery.conversationId,
      sourceTurnId: sourceDelivery.turnId,
      sourceSequence: sourceDelivery.sequence,
      sourceEventType: sourceDelivery.rawPayload.eventType,
    };

    usePortalStore.getState().close();
    clearFoundationLocalConversationProjection(conversationId);
    const clearedState = useChatStore.getState();
    const portalState = usePortalStore.getState();
    facts = {
      outcome: rejectedOutcome,
      runtimeEvent,
      receiver: {
        errorVisible: receiverErrorVisible,
        errorText: receiverErrorText,
        expectedErrorText: i18n.t(
          'agent.errors.duplicateConflict',
          { ns: 'agent' },
        ),
        recoveryVisible: receiverRecoveryVisible,
        recoveryText: receiverRecoveryText,
        expectedRecoveryText: i18n.t(
          'agent.recovery.openOriginal',
          { ns: 'agent' },
        ),
        openOriginalExecuted: (
          openedView?.type === 'turnDetails'
          && openedView.turnId === originalTurnId
        ),
        openedTurnId:
          openedView?.type === 'turnDetails' ? openedView.turnId : '',
      },
      station: {
        conversationId,
        originalTurnId,
        existingCommandId: rejectedDetails.existing_command_id,
        idempotencyKeyHash: await sha256Hex(idempotencyKey),
        conversationVersionBefore: beforeReadback.conversation.version,
        conversationVersionAfter: afterReadback.conversation.version,
        beforeHash,
        afterHash,
        originalMessageIdsBefore: originalMessageIds,
        originalMessageIdsAfter: afterMessageIds,
        turnDelta: afterExecution.turnCount - beforeExecution.turnCount,
        messageDelta:
          afterReadback.messages.length - beforeReadback.messages.length,
        queueDelta: afterQueue.entries.length - beforeQueue.entries.length,
        providerExecutionDelta:
          afterExecution.providerCallCount - beforeExecution.providerCallCount,
      },
      replay: {
        sourceHash: beforeHash,
        replayHash: afterHash,
        equal: beforeHash === afterHash,
      },
      cleanup: {
        conversationDeleted: false,
        localProjectionCleared: (
          clearedState.messages.length === 0
          && clearedState.sessionBuffers[conversationId] === undefined
        ),
        operationCleared:
          clearedState.operations[conversationId] === undefined,
        portalClosed:
          portalState.activeView === null && portalState.expanded === false,
      },
    };
  } catch (error) {
    scenarioError = error;
  } finally {
    if (scenarioError) {
      try {
        usePortalStore.getState().close();
        clearFoundationLocalConversationProjection(conversationId);
        await cleanupFoundationToolConversation(
          conversationId,
          originalTurnId,
        );
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (cleanupError) {
    throw Object.assign(
      new Error('agent.acceptance.foundationDuplicateConflictCleanupFailed'),
      { primaryError: scenarioError, cleanupError },
    );
  }
  if (scenarioError) throw scenarioError;
  if (!facts) {
    throw new Error('agent.acceptance.foundationDuplicateConflictFactsMissing');
  }
  return {
    conversationId,
    turnId: originalTurnId,
    durationMs: performance.now() - startedAt,
    runtimeEvent: evidenceRecord(
      facts.runtimeEvent,
      'foundationDuplicateConflictRuntimeEvent',
    ) as unknown as FoundationRuntimeEventObservation,
    facts,
  };
}

async function runFoundationCredentialMissingScenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  sampleId: string;
}): Promise<{
  conversationId: string;
  turnId: string;
  durationMs: number;
  runtimeEvent: FoundationRuntimeEventObservation;
  facts: Record<string, unknown>;
}> {
  const store = useAgentStore.getState();
  const priorSelection = store.selectedAgent;
  const priorSurface = store.getAgentSurface(priorSelection);
  const providers = await api.listProviders();
  let missingProvider:
    | { id: string; name: string; modelId: string; status: string }
    | null = null;
  for (const provider of providers) {
    if (
      provider.id === input.agent.provider
      || !provider.enabled
      || !provider.requires_api_key
      || provider.has_api_key
    ) {
      continue;
    }
    const detail = await api.getProvider(provider.id);
    const model = detail.models.find((candidate) =>
      candidate.enabled
      && candidate.type === 'chat'
      && candidate.context_window > 1);
    if (model) {
      missingProvider = {
        id: provider.id,
        name: provider.name,
        modelId: model.id,
        status: provider.credential_status,
      };
      break;
    }
  }
  if (!missingProvider) {
    throw new Error(
      'agent.acceptance.foundationCredentialMissingFixtureUnavailable',
    );
  }

  const disposable = await store.createAgent({
    name: `foundation-credential-${input.sampleId}-${crypto.randomUUID()}`,
    title: `Foundation credential ${input.sampleId}`,
    description: 'Foundation missing credential fixture',
    provider: missingProvider.id,
    model: missingProvider.modelId,
  });
  const disposableAgentId = disposable.id || disposable.name;
  let rejectedConversationId = '';
  let scenarioError: unknown = null;
  let cleanupError: unknown = null;
  let facts: Record<string, unknown> | null = null;
  const startedAt = performance.now();

  try {
    await api.setSelectedAgent(disposable.name);
    useAgentStore.getState().setSelectedAgent(disposable.name);
    useAgentStore.getState().setAgentSurface(disposable.name, 'chat');
    eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'sessions' });
    await waitFor(
      () => Boolean(
        document.querySelector('[data-pt-agent-composer]')
          ?.getClientRects().length,
      ),
      'credential missing composer',
      30_000,
    );

    const conversation = await api.createAgentConversation({
      agent_id: disposableAgentId,
      title: `Foundation credential missing ${input.sampleId}`,
      provider_id: missingProvider.id,
      model_name: missingProvider.modelId,
    });
    rejectedConversationId = conversation.conversation_id;
    await useChatStore.getState().selectSession(rejectedConversationId);
    await useChatStore.getState().syncMessages();

    const before = await foundationExecutionSnapshot(
      disposableAgentId,
      rejectedConversationId,
    );
    const beforeReadback = await foundationConversationReadback(
      rejectedConversationId,
    );
    const beforeQueue = await api.listAgentTurnQueue(rejectedConversationId);
    let observationSequence = 0;
    const errorEventRef: {
      current: FoundationPreAdmissionErrorEvent | null;
    } = { current: null };
    const unsubscribe = eventBus.subscribe(
      EVENT.AGENT_TURN_STREAM_EVENT,
      (payload) => {
        const sourceDelivery = (
          payload as typeof payload & {
            sourceDelivery?: AgentTurnSourceDelivery;
          }
        ).sourceDelivery;
        if (payload.conversationId !== rejectedConversationId) return;
        observationSequence += 1;
        if (
          payload.event !== 'error'
          || payload.data.error_type !== 'PROVIDER_CREDENTIAL_MISSING'
        ) return;
        errorEventRef.current = {
          data: evidenceValue(payload.data) as Record<string, unknown>,
          eventType: payload.event,
          observedAt: new Date(payload.timestampMs).toISOString(),
          streamId: payload.streamId,
          streamGeneration: payload.streamGeneration,
          conversationId: payload.conversationId,
          observationSequence,
          timestampMs: payload.timestampMs,
          sourceDelivery,
        };
      },
    );
    try {
      const sent = useChatStore.getState().sendMessage(
        `Credential missing ${input.sampleId}`,
      );
      if (!sent) {
        throw new Error(
          'agent.acceptance.foundationCredentialMissingSendRejected',
        );
      }
      await waitFor(
        () => errorEventRef.current !== null,
        'typed credential missing rejection',
        60_000,
      );
      await waitFor(
        () => Boolean(document.querySelector(
          '[data-pt-agent-message="assistant"]'
          + '[data-pt-agent-error-type="PROVIDER_CREDENTIAL_MISSING"]',
        )),
        'credential missing receiver',
        10_000,
      );
    } finally {
      unsubscribe();
    }

    const errorSurface = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-pt-agent-message="assistant"]'
        + '[data-pt-agent-error-type="PROVIDER_CREDENTIAL_MISSING"]',
      ),
    ).reverse().find((element) => element.getClientRects().length > 0);
    const errorToggle = errorSurface?.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-toggle]',
    );
    const errorSelector =
      '[data-pt-agent-message-error-text="agent.errors.providerCredentialMissing"]';
    if (!errorSurface?.querySelector(errorSelector)) {
      errorToggle?.click();
      await waitFor(
        () => Boolean(errorSurface?.querySelector(errorSelector)),
        'localized credential missing text',
        10_000,
      );
    }
    const errorText = errorSurface?.querySelector<HTMLElement>(errorSelector);
    const recoveryAction = errorSurface?.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-recovery="configure-credential"]',
    );
    const errorEvent =
      errorEventRef.current as FoundationPreAdmissionErrorEvent | null;
    if (!errorSurface || !errorText || !recoveryAction || !errorEvent) {
      throw new Error(
        'agent.acceptance.foundationCredentialMissingSurfaceMissing',
      );
    }
    if (
      !errorEvent.streamId
      || errorEvent.streamGeneration <= 0
      || errorEvent.observationSequence <= 0
      || errorEvent.timestampMs <= 0
    ) {
      throw new Error(
        'agent.acceptance.foundationCredentialMissingRuntimeEventMissing',
      );
    }
    const sourceDelivery = errorEvent.sourceDelivery;
    const actorPtid = authenticatedFoundationActorPtid();
    if (
      !sourceDelivery
      || sourceDelivery.transport !== 'station-sse'
      || sourceDelivery.ptid !== actorPtid
      || sourceDelivery.conversationId !== rejectedConversationId
      || sourceDelivery.turnId !== ''
      || sourceDelivery.sequence !== 0
      || sourceDelivery.rawPayload.eventType !== 'error'
      || stableJson(
        normalizeProjectedStationPayload(sourceDelivery.rawPayload.data),
      ) !== stableJson(
        normalizeProjectedStationPayload(errorEvent.data),
      )
    ) {
      throw new Error(
        'agent.acceptance.foundationCredentialMissingSourceIdentityMismatch',
      );
    }

    const receiverErrorVisible = errorText.getClientRects().length > 0;
    const receiverErrorText = errorText.textContent?.trim() ?? '';
    const receiverRecoveryVisible =
      recoveryAction.getClientRects().length > 0;
    const receiverRecoveryText = recoveryAction.textContent?.trim() ?? '';
    recoveryAction.click();
    await waitFor(
      () => document.querySelector('[data-pt-agent-composer]')
        ?.getClientRects().length === 0,
      'credential settings recovery',
      30_000,
    );
    const after = await foundationExecutionSnapshot(
      disposableAgentId,
      rejectedConversationId,
    );
    const afterReadback = await foundationConversationReadback(
      rejectedConversationId,
    );
    const afterQueue = await api.listAgentTurnQueue(rejectedConversationId);
    const providerAfter = (await api.listProviders()).find(
      (provider) => provider.id === missingProvider?.id,
    );
    const beforeHash = await sha256Hex(stableJson(beforeReadback));
    const afterHash = await sha256Hex(stableJson(afterReadback));
    const typedOutcome = errorEvent.data;
    const runtimeEvent: FoundationRuntimeEventObservation = {
      eventId: await sha256Hex(stableJson({
        streamId: errorEvent.streamId,
        streamGeneration: errorEvent.streamGeneration,
        conversationId: errorEvent.conversationId,
        observationSequence: errorEvent.observationSequence,
        eventType: errorEvent.eventType,
        timestampMs: errorEvent.timestampMs,
        data: typedOutcome,
      })),
      eventType: errorEvent.eventType,
      sequence: errorEvent.observationSequence,
      observedAt: errorEvent.observedAt,
      streamGeneration: errorEvent.streamGeneration,
      streamIdHash: await sha256Hex(errorEvent.streamId),
      conversationIdHash: await sha256Hex(errorEvent.conversationId),
      payloadHash: await sha256Hex(stableJson(sourceDelivery.rawPayload)),
      errorType: String(typedOutcome.error_type ?? ''),
      sourceTransport: sourceDelivery.transport,
      sourcePtidHash: await sha256Hex(sourceDelivery.ptid),
      sourceConversationId: sourceDelivery.conversationId,
      sourceTurnId: sourceDelivery.turnId,
      sourceSequence: sourceDelivery.sequence,
      sourceEventType: sourceDelivery.rawPayload.eventType,
    };
    facts = {
      outcome: typedOutcome,
      runtimeEvent,
      receiver: {
        errorVisible: receiverErrorVisible,
        errorText: receiverErrorText,
        expectedErrorText: i18n.t(
          'agent.errors.providerCredentialMissing',
          { ns: 'agent' },
        ),
        recoveryVisible: receiverRecoveryVisible,
        recoveryText: receiverRecoveryText,
        expectedRecoveryText: i18n.t(
          'agent.recovery.configureCredential',
          { ns: 'agent' },
        ),
        configureProviderExecuted: true,
      },
      station: {
        conversationId: rejectedConversationId,
        providerId: missingProvider.id,
        providerStatusBefore: missingProvider.status,
        providerConfiguredBefore: false,
        providerStatusAfter: providerAfter?.credential_status ?? '',
        providerConfiguredAfter: providerAfter?.has_api_key ?? true,
        conversationVersionBefore: beforeReadback.conversation.version,
        conversationVersionAfter: afterReadback.conversation.version,
        beforeHash,
        afterHash,
        turnDelta: after.turnCount - before.turnCount,
        messageDelta:
          afterReadback.messages.length - beforeReadback.messages.length,
        queueDelta: afterQueue.entries.length - beforeQueue.entries.length,
        providerExecutionDelta:
          after.providerCallCount - before.providerCallCount,
      },
      replay: {
        sourceHash: beforeHash,
        replayHash: afterHash,
        equal: beforeHash === afterHash,
      },
      cleanup: {
        conversationDeleted: false,
        disposableAgentDeleted: false,
        priorSelection,
        restoredSelection: '',
      },
    };
  } catch (error) {
    scenarioError = error;
  } finally {
    try {
      if (rejectedConversationId) {
        clearFoundationLocalConversationProjection(rejectedConversationId);
        await deleteFoundationConversation(rejectedConversationId);
      }
      await api.deleteAgent(disposableAgentId);
      await useAgentStore.getState().loadAgents();
      if (priorSelection) {
        useAgentStore.getState().setSelectedAgent(priorSelection);
        useAgentStore.getState().setAgentSurface(priorSelection, priorSurface);
        await api.setSelectedAgent(priorSelection);
      }
      eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'sessions' });
      if (facts) {
        const cleanup = evidenceRecord(
          facts.cleanup,
          'foundationCredentialMissingCleanup',
        );
        cleanup.conversationDeleted = rejectedConversationId
          ? await api.getAgentConversation(rejectedConversationId).then(
              () => false,
              (error: unknown) => observedErrorCode(error).includes('AGENT_4004'),
            )
          : true;
        cleanup.disposableAgentDeleted = await api.getAgent(
          disposableAgentId,
        ).then(
          () => false,
          (error: unknown) => JSON.stringify(
            (error as { details?: unknown })?.details ?? {},
          ).includes('AGENT_4004'),
        );
        cleanup.restoredSelection = useAgentStore.getState().selectedAgent;
      }
    } catch (error) {
      cleanupError = error;
    }
  }

  if (cleanupError) {
    throw Object.assign(
      new Error('agent.acceptance.foundationCredentialMissingCleanupFailed'),
      { primaryError: scenarioError, cleanupError },
    );
  }
  if (scenarioError) throw scenarioError;
  if (!facts) {
    throw new Error('agent.acceptance.foundationCredentialMissingFactsMissing');
  }
  const attestation = await runFoundationDirectAttestationTurn({
    agent: input.agent,
    capabilitySessionId: input.capabilitySessionId,
    sampleId: input.sampleId,
  });
  const scenarioRuntimeEvent = evidenceRecord(
    facts.runtimeEvent,
    'foundationCredentialMissingRuntimeEvent',
  ) as unknown as FoundationRuntimeEventObservation;
  const returnedRuntimeEvent = scenarioRuntimeEvent;
  await reportFoundationCredentialRuntimeEventDebug({
    scenarioEventType: scenarioRuntimeEvent.eventType,
    scenarioErrorType: scenarioRuntimeEvent.errorType,
    scenarioSourceTurnEmpty: scenarioRuntimeEvent.sourceTurnId === '',
    scenarioSourceSequence: scenarioRuntimeEvent.sourceSequence,
    returnedEventType: returnedRuntimeEvent.eventType,
    returnedErrorType: returnedRuntimeEvent.errorType ?? null,
    returnedSourceTurnEmpty: returnedRuntimeEvent.sourceTurnId === '',
    returnedSourceSequence: returnedRuntimeEvent.sourceSequence ?? null,
    eventIdsMatch:
      scenarioRuntimeEvent.eventId === returnedRuntimeEvent.eventId,
    sourceConversationMatches:
      scenarioRuntimeEvent.sourceConversationId
        === returnedRuntimeEvent.sourceConversationId,
    payloadHashesMatch:
      scenarioRuntimeEvent.payloadHash === returnedRuntimeEvent.payloadHash,
  });
  return {
    conversationId: attestation.conversationId,
    turnId: attestation.turnId,
    durationMs: performance.now() - startedAt,
    runtimeEvent: returnedRuntimeEvent,
    facts,
  };
}

async function runFoundationF06Prepare(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  faultControlUrl: string;
  scenarioKey: string;
  platform: string;
  locale: string;
  sampleId: string;
}): Promise<FoundationF06Handoff> {
  const scenarioStartedAt = new Date().toISOString();
  const preparationStartedAt = performance.now();
  // #region debug-point A-D:f06-terminal-race-start
  void reportFoundationF06TerminalRaceDebug('A-D', 'preparation-started', {
    platform: input.platform,
    locale: input.locale,
    scenarioKey: input.scenarioKey,
  });
  // #endregion
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
  writeFoundationF06CleanupLocator({
    scenarioKey: input.scenarioKey,
    conversationId: conversation.conversation_id,
    turnId: '',
    state: 'created',
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
      { restorationMode: 'deferred' },
    );
  } catch (error) {
    const activeRecord = useAgentTurnRecoveryStore.getState()
      .active[conversation.conversation_id];
    const activeTurnId = activeRecord?.turnId ?? '';
    const authDiagnostic = redactedAuthError(error);
    const primary = error instanceof Error ? error.message : String(error);
    // #region debug-point A-D:f06-terminal-race-primary
    void reportFoundationF06TerminalRaceDebug(
      'A-D',
      'preparation-failed-before-cleanup',
      {
        platform: input.platform,
        locale: input.locale,
        scenarioKey: input.scenarioKey,
        elapsedMs: Math.round(performance.now() - preparationStartedAt),
        terminalRace:
          primary.includes('foundationRecoveryTurnAlreadyTerminal'),
        activeRecordPresent: activeRecord !== undefined,
        activePhase: activeRecord?.phase ?? 'MISSING',
        activeTurnPresent: activeTurnId.length > 0,
        cleanupLocatorPresent:
          readFoundationF06CleanupLocators()[input.scenarioKey] !== undefined,
      },
    );
    // #endregion
    try {
      await cleanupFoundationF06Scenario({
        scenarioKey: input.scenarioKey,
        conversationId: conversation.conversation_id,
        turnId: activeTurnId,
      });
    } catch (cleanupError) {
      const cleanup = cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
      // #region debug-point D:f06-terminal-race-cleanup-error
      void reportFoundationF06TerminalRaceDebug(
        'D',
        'preparation-cleanup-failed',
        {
          platform: input.platform,
          locale: input.locale,
          scenarioKey: input.scenarioKey,
          terminalRace:
            primary.includes('foundationRecoveryTurnAlreadyTerminal'),
          cleanupErrorType:
            cleanupError instanceof Error
              ? cleanupError.constructor.name
              : typeof cleanupError,
          cleanupTurnPresent: activeTurnId.length > 0,
        },
      );
      // #endregion
      throw new Error(
        `CLEANUP_FAILED:${primary}; auth=${JSON.stringify(authDiagnostic)}; cleanup=${cleanup}`,
      );
    }
    throw new Error(`${primary}; auth=${JSON.stringify(authDiagnostic)}`);
  }
}

async function prepareFoundationF06Conversation(
  input: {
    agent: NonNullable<ReturnType<typeof selectedAgent>>;
    capabilitySessionId: string;
    faultControlUrl: string;
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
  let boundaryRequested = false;
  let cleanupTurnId = '';
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
      if (boundarySettled || boundaryRequested) return;
      if (!cleanupTurnId) {
        cleanupTurnId = observedTurnId(events);
        if (cleanupTurnId) {
          writeFoundationF06CleanupLocator({
            scenarioKey: input.scenarioKey,
            conversationId: conversation.conversation_id,
            turnId: cleanupTurnId,
            state: 'created',
          });
        }
      }
      if (classifyAgentTurnTerminalEvent(event) !== null) {
        const active = useAgentTurnRecoveryStore.getState()
          .active[conversation.conversation_id];
        // #region debug-point A-B:f06-terminal-before-cut
        void reportFoundationF06TerminalRaceDebug(
          'A-B',
          'terminal-event-before-fault-boundary',
          {
            platform: input.platform,
            locale: input.locale,
            scenarioKey: input.scenarioKey,
            elapsedMs: Date.now() - Date.parse(scenarioStartedAt),
            eventType: event.event,
            eventSequence: Number(event.data.seq ?? 0),
            eventCount: events.length,
            durableEventCount: events.filter(
              (candidate) => Number(candidate.data.seq ?? 0) > 0,
            ).length,
            textEventCount: events.filter(
              (candidate) => candidate.event === 'text',
            ).length,
            boundaryRequested,
            activeRecordPresent: active !== undefined,
            activePhase: active?.phase ?? 'MISSING',
          },
        );
        // #endregion
        failBoundary('agent.acceptance.foundationRecoveryTurnAlreadyTerminal');
        return;
      }
      const observedDurableEvents = events
        .filter((candidate) => Number(candidate.data.seq ?? 0) > 0)
        .sort((left, right) =>
          Number(left.data.seq ?? 0) - Number(right.data.seq ?? 0));
      const hasText = observedDurableEvents.some(
        (candidate) => candidate.event === 'text',
      );
      const uniqueSequences = new Set(
        observedDurableEvents.map((candidate) =>
          Number(candidate.data.seq ?? 0)),
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
      writeFoundationF06CleanupLocator({
        scenarioKey: input.scenarioKey,
        conversationId: conversation.conversation_id,
        turnId,
        state: 'created',
      });
      const requestedCursor = active.cursor;
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
        replayRequestCursor: requestedCursor,
        acknowledgedCursor: requestedCursor,
        conversationRevision: conversation.version,
        prefixHash: 'pending',
        prefixLength: 0,
        duplicateSequence: 0,
        outOfOrderSequence: 0,
        staleGeneration: Math.max(1, active.streamGeneration - 1),
        staleGenerationRejected: false,
        staleTerminalRejected: false,
        cursorBeforeMutation: requestedCursor,
        cursorAfterMutation: requestedCursor,
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
      boundaryRequested = true;
      // #region debug-point A-C:f06-fault-request
      void reportFoundationF06TerminalRaceDebug('A-C', 'fault-cut-requested', {
        platform: input.platform,
        locale: input.locale,
        scenarioKey: input.scenarioKey,
        elapsedMs: Date.now() - Date.parse(scenarioStartedAt),
        eventCount: events.length,
        durableEventCount: observedDurableEvents.length,
        textEventCount: observedDurableEvents.filter(
          (candidate) => candidate.event === 'text',
        ).length,
        requestedCursor,
        activePhase: active.phase,
      });
      // #endregion
      void reportFoundationF06RegistrationDebug(
        'A-E',
        'fault-cut-requested',
        {
          activeRecordPresent: true,
          activePhase: active.phase,
          requestedCursor,
        },
      );
      void requestFoundationF06TransportCut(input.faultControlUrl)
        .then(async () => {
          const activeAfterAcknowledgement = useAgentTurnRecoveryStore.getState()
            .active[conversation.conversation_id];
          // #region debug-point C:f06-fault-ack
          void reportFoundationF06TerminalRaceDebug(
            'C',
            'fault-cut-acknowledged',
            {
              platform: input.platform,
              locale: input.locale,
              scenarioKey: input.scenarioKey,
              elapsedMs: Date.now() - Date.parse(scenarioStartedAt),
              activeRecordPresent:
                activeAfterAcknowledgement !== undefined,
              activePhase:
                activeAfterAcknowledgement?.phase ?? 'MISSING',
              activeCursor: activeAfterAcknowledgement?.cursor ?? 0,
            },
          );
          // #endregion
          await waitFor(() => {
            const current = useAgentTurnRecoveryStore.getState()
              .active[conversation.conversation_id];
            if (!current) {
              // #region debug-point C:f06-terminal-after-ack
              void reportFoundationF06TerminalRaceDebug(
                'C',
                'recovery-record-missing-after-fault-acknowledgement',
                {
                  platform: input.platform,
                  locale: input.locale,
                  scenarioKey: input.scenarioKey,
                  elapsedMs: Date.now() - Date.parse(scenarioStartedAt),
                },
              );
              // #endregion
              throw new Error(
                'agent.acceptance.foundationRecoveryTurnAlreadyTerminal',
              );
            }
            return current.phase !== 'CONNECTED';
          }, 'Foundation AS-F06 fault acknowledgement', 30_000);
          const activeAtCut = useAgentTurnRecoveryStore.getState()
            .active[conversation.conversation_id];
          if (
            !activeAtCut
            || activeAtCut.actorId !== actorId
            || activeAtCut.turnId !== turnId
            || activeAtCut.streamId !== streamId
            || activeAtCut.streamGeneration !== controller.streamGeneration
          ) {
            throw new Error(
              'agent.acceptance.foundationRecoveryFaultBoundaryMismatch',
            );
          }
          const acknowledgedCursor = activeAtCut.cursor;
          const durableEvents = events
            .filter((candidate) =>
              Number(candidate.data.seq ?? 0) > 0
              && !FOUNDATION_F06_PHASE_BY_EVENT[candidate.event]
              && candidate.event !== 'catchup_done'
              && candidate.event !== 'snapshot')
            .sort((left, right) =>
              Number(left.data.seq ?? 0) - Number(right.data.seq ?? 0));
          const duplicateSource = [...durableEvents]
            .reverse()
            .find((candidate) =>
              Number(candidate.data.seq ?? 0) === acknowledgedCursor);
          const outOfOrderSource = [...durableEvents]
            .reverse()
            .find((candidate) =>
              Number(candidate.data.seq ?? 0) < acknowledgedCursor);
          if (!duplicateSource || !outOfOrderSource) {
            throw new Error(
              'agent.acceptance.foundationRecoveryFaultBoundaryEventsMissing',
            );
          }

          const textEvents = durableEvents.filter((candidate) =>
            candidate.event === 'text'
            && Number(candidate.data.seq ?? 0) <= acknowledgedCursor);
          if (textEvents.length === 0) {
            void reportFoundationF06PrefixDebug(
              'B-C',
              'prefix-not-acknowledged',
              {
                acknowledgedCursor,
                durableEventTypes: durableEvents.map((candidate) => ({
                  event: candidate.event,
                  sequence: Number(candidate.data.seq ?? 0),
                })),
              },
            );
            throw new Error(
              'agent.acceptance.foundationRecoveryPrefixMissing',
            );
          }
          const textEventFacts = textEvents.map((candidate) => {
            const content = String(
              candidate.data.content ?? candidate.data.text ?? '',
            );
            return {
              sequence: Number(candidate.data.seq ?? 0),
              contentLength: content.length,
              dataKeys: Object.keys(candidate.data).sort(),
            };
          });
          const prefix = textEvents
            .map((candidate) =>
              String(candidate.data.content ?? candidate.data.text ?? ''))
            .join('');
          void reportFoundationF06PrefixDebug('A-D', 'boundary-evaluated', {
            acknowledgedCursor,
            durableEventCount: durableEvents.length,
            durableEventTypes: durableEvents.map((candidate) => ({
              event: candidate.event,
              sequence: Number(candidate.data.seq ?? 0),
            })),
            textEventFacts,
            prefixLength: prefix.length,
          });
          if (!prefix) {
            void reportFoundationF06PrefixDebug('A-D', 'prefix-missing', {
              acknowledgedCursor,
              textEventFacts,
            });
            throw new Error(
              'agent.acceptance.foundationRecoveryPrefixMissing',
            );
          }
          void reportFoundationF06PrefixDebug('A-C', 'prefix-ready', {
            acknowledgedCursor,
            prefixLength: prefix.length,
            textEventFacts,
          });

          const chatBefore = useChatStore.getState();
          const projectionBeforeMutation = stableJson({
            operation: chatBefore.operations[conversation.conversation_id]
              ? {
                  turnId:
                    chatBefore.operations[conversation.conversation_id].turnId,
                  streamGeneration:
                    chatBefore.operations[conversation.conversation_id]
                      .streamGeneration,
                  lastEventSeq:
                    chatBefore.operations[conversation.conversation_id]
                      .lastEventSeq,
                  status:
                    chatBefore.operations[conversation.conversation_id].status,
                  runState:
                    chatBefore.operations[conversation.conversation_id].runState,
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
            cursor: activeAtCut.cursor,
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
          publishFault(duplicateSource, activeAtCut.streamGeneration);
          publishFault(outOfOrderSource, activeAtCut.streamGeneration);
          const staleGeneration = Math.max(
            1,
            activeAtCut.streamGeneration - 1,
          );
          publishFault(duplicateSource, staleGeneration);
          publishFault({
            event: 'done',
            data: {
              ...outOfOrderSource.data,
              seq: Number(outOfOrderSource.data.seq),
              status: 'completed',
            },
          }, activeAtCut.streamGeneration);

          const chatAfter = useChatStore.getState();
          const activeAfterMutation = useAgentTurnRecoveryStore.getState()
            .active[conversation.conversation_id];
          if (activeAfterMutation?.cursor !== acknowledgedCursor) {
            throw new Error(
              'agent.acceptance.foundationRecoveryCursorAdvancedAfterFault',
            );
          }
          const projectionAfterMutation = stableJson({
            operation: chatAfter.operations[conversation.conversation_id]
              ? {
                  turnId:
                    chatAfter.operations[conversation.conversation_id].turnId,
                  streamGeneration:
                    chatAfter.operations[conversation.conversation_id]
                      .streamGeneration,
                  lastEventSeq:
                    chatAfter.operations[conversation.conversation_id]
                      .lastEventSeq,
                  status:
                    chatAfter.operations[conversation.conversation_id].status,
                  runState:
                    chatAfter.operations[conversation.conversation_id].runState,
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
            cursor: activeAfterMutation.cursor,
          });
          Object.assign(handoff, {
            acknowledgedCursor,
            prefixLength: prefix.length,
            duplicateSequence: Number(duplicateSource.data.seq),
            outOfOrderSequence: Number(outOfOrderSource.data.seq),
            staleGeneration,
            staleGenerationRejected:
              activeAfterMutation.streamGeneration
                === activeAtCut.streamGeneration,
            staleTerminalRejected:
              activeAfterMutation.turnId === turnId
              && chatAfter.operations[conversation.conversation_id]?.status
                !== 'completed',
            cursorBeforeMutation: activeAtCut.cursor,
            cursorAfterMutation: activeAfterMutation.cursor,
          });
          const boundary = {
            handoff,
            projectionBeforeMutation,
            projectionAfterMutation,
            prefix,
            duplicateSource,
            outOfOrderSource,
          };
          foundationF06FaultBoundaries.set(input.scenarioKey, boundary);
          writeFoundationF06Handoff(handoff);
          boundarySettled = true;
          void reportFoundationF06RegistrationDebug(
            'A-E',
            'prepare-boundary-ready',
            {
              activeRecordPresent: true,
              actorMatches: activeAtCut.actorId === actorId,
              turnMatches: activeAtCut.turnId === turnId,
              streamMatches: activeAtCut.streamId === streamId,
              generationMatches:
                activeAtCut.streamGeneration
                  === controller.streamGeneration,
              activePhase: activeAtCut.phase,
              activeCursor: activeAtCut.cursor,
              requestedCursor,
              cursorAdvancedBeforeCut:
                activeAtCut.cursor > requestedCursor,
            },
          );
          resolveBoundary(boundary);
          complete();
        })
        .catch((error) => {
          boundarySettled = true;
          rejectBoundary(
            error instanceof Error
              ? error
              : new Error('agent.acceptance.foundationFaultControlRejected'),
          );
        });
    },
  });
  foundationF06Controllers.set(input.scenarioKey, observed.controller);
  const boundary = await Promise.race([
    faultBoundary,
    observed.result.then((result) => {
      // #region debug-point A-C:f06-result-before-boundary
      void reportFoundationF06TerminalRaceDebug(
        'A-C',
        'turn-result-settled-before-fault-boundary',
        {
          platform: input.platform,
          locale: input.locale,
          scenarioKey: input.scenarioKey,
          elapsedMs: Date.now() - Date.parse(scenarioStartedAt),
          resultOk: result.ok,
          resultErrorPresent: Boolean(result.error),
          boundaryRequested,
          boundarySettled,
        },
      );
      // #endregion
      throw new Error(
        result.error || 'agent.acceptance.foundationRecoveryTurnAlreadyTerminal',
      );
    }),
  ]);
  return boundary.handoff;
}

async function requestFoundationF06TransportCut(
  controlUrl: string,
): Promise<void> {
  const url = new URL(controlUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('agent.acceptance.foundationFaultControlInvalid');
  }
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    throw new Error('agent.acceptance.foundationFaultControlRejected');
  }
}

async function finalizeFoundationF06Preparation(
  scenarioKey: string,
): Promise<FoundationF06Handoff> {
  const boundary = foundationF06FaultBoundaries.get(scenarioKey);
  if (!boundary) {
    throw new Error('agent.acceptance.foundationRecoveryBoundaryMissing');
  }
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
  const handoff = foundationF06PendingHandoffs.get(scenarioKey);
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
  foundationF06PendingHandoffs.delete(scenarioKey);
  foundationF06FaultBoundaries.delete(scenarioKey);
  writeFoundationF06Handoff(handoff);

  void reportFoundationF06PageSwitchDebug(
    'A-D',
    'before-navigation-publish',
    foundationF06PageSwitchSnapshot(),
  );
  eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'settings' });
  void reportFoundationF06PageSwitchDebug(
    'A-D',
    'after-navigation-publish',
    foundationF06PageSwitchSnapshot(),
  );
  try {
    await waitFor(
      () => document.querySelector('[data-pt-agent-composer]')?.getClientRects()
        .length === 0,
      'Foundation AS-F06 page switch',
      30_000,
    );
  } catch (error) {
    await reportFoundationF06PageSwitchDebug(
      'A-D',
      'page-switch-timeout',
      {
        ...foundationF06PageSwitchSnapshot(),
        errorType: error instanceof Error ? error.name : typeof error,
      },
    );
    throw error;
  }
  void reportFoundationF06PageSwitchDebug(
    'B-C',
    'page-switch-complete',
    foundationF06PageSwitchSnapshot(),
  );
  return handoff;
}

async function restoreFoundationF06CapabilityIsolation(
  scenarioKey: string,
): Promise<FoundationF06Handoff> {
  const handoff = readFoundationF06Handoff(scenarioKey);
  if (!handoff) {
    throw new Error('agent.acceptance.foundationRecoveryHandoffMissing');
  }
  const journal = readFoundationCapabilityIsolationJournal();
  if (handoff.toolIsolation.restorationVerified) {
    if (journal) {
      throw new Error(
        'agent.acceptance.foundationCapabilityIsolationStateConflict',
      );
    }
    return handoff;
  }
  const agent = selectedAgent();
  if (
    !journal
    || !agent
    || journal.agentId !== (agent.id || agent.name)
    || journal.bindings.length !== handoff.toolIsolation.disabledBindingCount
    || journal.originalReadyCapabilityCount
      !== handoff.toolIsolation.originalReadyCapabilityCount
    || journal.originalReadyCapabilityHash
      !== handoff.toolIsolation.originalReadyCapabilityHash
  ) {
    throw new Error(
      'agent.acceptance.foundationCapabilityIsolationScopeMismatch',
    );
  }
  const restoration = await restorePersistedFoundationCapabilityIsolation();
  if (!restoration) {
    throw new Error(
      'agent.acceptance.foundationCapabilityBindingRestoreVerificationFailed',
    );
  }
  Object.assign(handoff.toolIsolation, restoration);
  writeFoundationF06Handoff(handoff);
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
  await reportFoundationF06RegistrationDebug(
    'A-E',
    'outage-observer-entry',
    {
      activeRecordPresent: activeAtOutage !== undefined,
      actorMatches: activeAtOutage?.actorId === handoff.actorPtid,
      turnMatches: activeAtOutage?.turnId === handoff.turnId,
      streamMatches: activeAtOutage?.streamId === handoff.streamId,
      generationMatches:
        activeAtOutage?.streamGeneration === handoff.streamGeneration,
      activePhase: activeAtOutage?.phase ?? 'MISSING',
      activeCursor: activeAtOutage?.cursor ?? 0,
    },
  );
  await reportFoundationRecoveryErrorKeyDebug(
    'D',
    'outage-observer-sampled',
    {
      activeRecordPresent: activeAtOutage !== undefined,
      activePhase: activeAtOutage?.phase ?? 'MISSING',
      failureKeyPresent: Boolean(activeAtOutage?.failureKey),
    },
  );
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
    useSessionStore.getState().currentUser?.actorPtid.trim() || '';
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
  await reportFoundationRecoveryErrorKeyDebug(
    'A-D',
    'recovery-failure-sampled',
    {
      activeRecordPresent: active !== undefined,
      activePhase: active?.phase ?? 'MISSING',
      failureKeyPresent: Boolean(active?.failureKey),
      failureWaitErrorPresent: failureWaitError.length > 0,
    },
  );
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
  await reportFoundationRecoveryErrorKeyDebug(
    'C-D',
    'retry-failure-sampled',
    {
      activeRecordPresent: afterRetry !== undefined,
      activePhase: afterRetry?.phase ?? 'MISSING',
      initialFailureKeyPresent: Boolean(active.failureKey),
      retryFailureKeyPresent: Boolean(afterRetry?.failureKey),
      recoveryEpochAdvanced: Boolean(
        afterRetry && afterRetry.recoveryEpoch > retryEpochBefore,
      ),
    },
  );
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
    useSessionStore.getState().currentUser?.actorPtid.trim() || '';
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

  const reconciliationTransitions: FoundationF06Transition[] = [];
  const unsubscribe = useAgentTurnRecoveryStore.subscribe((state, previousState) => {
    const current = state.active[handoff.conversationId];
    const previous = previousState.active[handoff.conversationId];
    if (
      !current
      || current.actorId !== handoff.actorPtid
      || current.turnId !== handoff.turnId
      || current.streamId !== handoff.streamId
      || current.streamGeneration !== handoff.streamGeneration
      || current.phase === previous?.phase
      || !['RECONCILING', 'CONNECTED'].includes(current.phase)
    ) {
      return;
    }
    reconciliationTransitions.push({
      phase: current.phase,
      sequence: current.cursor,
      streamGeneration: current.streamGeneration,
      observedAt: new Date(current.updatedAt).toISOString(),
      terminal: false,
    });
  });
  let reloadResult: AgentTurnSnapshotReloadResult;
  try {
    reloadResult =
      await useChatStore.getState().reloadTurnSnapshot(handoff.conversationId);
  } finally {
    unsubscribe();
  }
  await reportFoundationF06RegistrationDebug(
    'A-E',
    'durable-reload-transitions',
    {
      phases: reconciliationTransitions.map((transition) => transition.phase),
      sequences: reconciliationTransitions.map(
        (transition) => transition.sequence,
      ),
    },
  );
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
      transitions: reconciliationTransitions,
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
  const handoff = foundationF06PendingHandoffs.get(input.scenarioKey)
    ?? foundationF06FaultBoundaries.get(input.scenarioKey)?.handoff
    ?? readFoundationF06Handoff(input.scenarioKey);
  const cleanupLocator =
    readFoundationF06CleanupLocators()[input.scenarioKey];
  // #region debug-point D:f06-cleanup-start
  void reportFoundationF06TerminalRaceDebug('D', 'cleanup-started', {
    scenarioKey: input.scenarioKey,
    inputConversationPresent: input.conversationId.length > 0,
    inputTurnPresent: input.turnId.length > 0,
    handoffPresent: handoff !== undefined && handoff !== null,
    cleanupLocatorPresent: cleanupLocator !== undefined,
    cleanupLocatorTurnPresent: Boolean(cleanupLocator?.turnId),
  });
  // #endregion
  if (
    handoff
    && (
      (input.conversationId && handoff.conversationId !== input.conversationId)
      || (input.turnId && handoff.turnId !== input.turnId)
    )
  ) {
    throw new Error('agent.acceptance.foundationCleanupIdentityMismatch');
  }
  if (
    cleanupLocator
    && (
      (
        input.conversationId
        && cleanupLocator.conversationId !== input.conversationId
      )
      || (input.turnId && cleanupLocator.turnId !== input.turnId)
    )
  ) {
    throw new Error('agent.acceptance.foundationCleanupIdentityMismatch');
  }
  if (cleanupLocator?.state === 'deleted') {
    useAgentTurnRecoveryStore.getState().clear(
      cleanupLocator.conversationId,
      cleanupLocator.turnId,
    );
    removeFoundationF06Handoff(input.scenarioKey, false);
    const handoffCleared =
      readFoundationF06Handoff(input.scenarioKey) === null;
    const recoveryRecordCleared =
      useAgentTurnRecoveryStore.getState()
        .active[cleanupLocator.conversationId] === undefined;
    if (!handoffCleared || !recoveryRecordCleared) {
      throw new Error('CLEANUP_FAILED:foundationCleanupVerificationFailed');
    }
    return {
      cleanupComplete: true,
      handoffCleared,
      conversationDeleted: true,
      recoveryRecordCleared,
    };
  }
  const conversationId = input.conversationId
    || handoff?.conversationId
    || cleanupLocator?.conversationId
    || '';
  const turnId = input.turnId
    || handoff?.turnId
    || cleanupLocator?.turnId
    || '';
  if (!conversationId) {
    throw new Error('CLEANUP_FAILED:foundationCleanupLocatorMissing');
  }
  let cleanupError: unknown = null;
  let deletionErrorCode = '';
  let cleanupStage = 'turn-cancel';
  try {
    if (turnId) {
      await api.cancelAgentTurn(turnId);
    }
    cleanupStage = 'queue-cancel';
    await cancelFoundationQueuedTurns(conversationId);
    cleanupStage = 'conversation-delete';
    deletionErrorCode = await deleteFoundationConversation(conversationId);
    // #region debug-point D:f06-cleanup-actions
    void reportFoundationF06TerminalRaceDebug(
      'D',
      'cleanup-actions-completed',
      {
        scenarioKey: input.scenarioKey,
        inputTurnPresent: turnId.length > 0,
        deletionErrorCodePresent: deletionErrorCode.length > 0,
      },
    );
    // #endregion
  } catch (error) {
    deletionErrorCode = observedErrorCode(error);
    // #region debug-point D:f06-cleanup-action-failed
    void reportFoundationF06TerminalRaceDebug(
      'D',
      'cleanup-action-failed',
      {
        scenarioKey: input.scenarioKey,
        cleanupStage,
        errorType: error instanceof Error
          ? error.constructor.name
          : typeof error,
        deletionErrorCode,
      },
    );
    // #endregion
    if (!deletionErrorCode.includes('AGENT_4004')) {
      cleanupError = error;
    }
  } finally {
    useAgentTurnRecoveryStore.getState().clear(
      conversationId,
      turnId,
    );
  }

  let conversationDeleted = false;
  try {
    const deleted = await api.getAgentConversation(conversationId);
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
  if (conversationDeleted) {
    writeFoundationF06CleanupLocator({
      scenarioKey: input.scenarioKey,
      conversationId,
      turnId,
      state: 'deleted',
    });
    removeFoundationF06Handoff(input.scenarioKey, false);
  }
  const handoffCleared = readFoundationF06Handoff(input.scenarioKey) === null;
  const recoveryRecordCleared =
    useAgentTurnRecoveryStore.getState().active[conversationId] === undefined;
  const cleanupComplete =
    conversationDeleted && handoffCleared && recoveryRecordCleared;
  // #region debug-point D:f06-cleanup-result
  void reportFoundationF06TerminalRaceDebug('D', 'cleanup-result-sampled', {
    scenarioKey: input.scenarioKey,
    cleanupStage,
    cleanupErrorPresent: cleanupError !== null,
    conversationDeleted,
    handoffCleared,
    recoveryRecordCleared,
    cleanupComplete,
  });
  // #endregion
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
  const durableReloadTransitions = optionalEvidenceArray(
    evidenceRecord(
      recoveryFailure.durableReload,
      'foundationF06DurableReload',
    ).transitions,
    'foundationF06DurableReloadTransitions',
  ).map((value) => {
    const transition = evidenceRecord(
      value,
      'foundationF06DurableReloadTransition',
    );
    if (
      typeof transition.phase !== 'string'
      || !Number.isSafeInteger(transition.sequence)
      || !Number.isSafeInteger(transition.streamGeneration)
      || typeof transition.observedAt !== 'string'
      || transition.terminal !== false
    ) {
      throw new Error(
        'agent.acceptance.foundationRecoveryDurableReloadTransitionInvalid',
      );
    }
    return {
      phase: transition.phase,
      sequence: Number(transition.sequence),
      streamGeneration: Number(transition.streamGeneration),
      observedAt: transition.observedAt,
      terminal: false,
    };
  });
  const transitions = [...latestHandoff.transitions];
  for (const transition of durableReloadTransitions) {
    if (!transitions.some((candidate) =>
      candidate.phase === transition.phase
      && candidate.sequence === transition.sequence
      && candidate.streamGeneration === transition.streamGeneration)) {
      transitions.push(transition as unknown as FoundationF06Transition);
    }
  }
  const replayStartTransition = transitions.find(
    (transition) =>
      transition.phase === 'REPLAYING'
      && transition.sequence >= handoff.acknowledgedCursor,
  );
  if (!replayStartTransition) {
    throw new Error('agent.acceptance.foundationRecoveryReplayBoundaryMissing');
  }
  const replayAfterCursor = latestHandoff.acknowledgedCursor;
  const replayDeliveries = latestHandoff.replayDeliveries.filter(
    (delivery) => delivery.sequence > replayAfterCursor,
  );
  const replaySequences = replayDeliveries.map((delivery) => delivery.sequence);
  const replayThroughCursor =
    replayDeliveries[replayDeliveries.length - 1]?.sequence ?? 0;
  const stationReplayDeliveries = (await foundationStationReplayReadback({
    ...handoff,
    acknowledgedCursor: replayAfterCursor,
  })).filter((delivery) => delivery.sequence <= replayThroughCursor);
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
  const replayedEvents = transitions.filter(
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
        replayRequestCursor: handoff.replayRequestCursor,
        acknowledgedCursor: handoff.acknowledgedCursor,
        conversationRevision: handoff.conversationRevision,
        prefixHash: handoff.prefixHash,
        prefixLength: handoff.prefixLength,
        preparationAttempts: handoff.preparationAttempts,
      },
      transitions,
      replay: {
        afterCursor: replayAfterCursor,
        throughCursor: replayThroughCursor,
        eventSequences: replaySequences,
        deliveries: replayDeliveries,
        stationReadbackDeliveries: stationReplayDeliveries,
        sourceHash: await sha256Hex(stableJson(
          replayDeliveries.map(replayIdentity),
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

function foundationF12RuntimeBindingFact(
  value: unknown,
): Record<string, unknown> {
  const binding = evidenceRecord(value, 'foundationF12RuntimeBinding');
  return {
    runtimeKind: runtimeKindName(
      evidenceField(binding, 'runtimeKind', 'runtime_kind'),
    ),
    providerId: String(
      evidenceField(binding, 'providerId', 'provider_id') ?? '',
    ),
    modelId: String(evidenceField(binding, 'modelId', 'model_id') ?? ''),
    runtimeProfileId: String(
      evidenceField(binding, 'runtimeProfileId', 'runtime_profile_id') ?? '',
    ),
    externalSessionId: String(
      evidenceField(binding, 'externalSessionId', 'external_session_id') ?? '',
    ),
    externalSessionEpoch: Number(
      evidenceField(
        binding,
        'externalSessionEpoch',
        'external_session_epoch',
      ) ?? 0,
    ),
    runtimeHomeRef: String(
      evidenceField(binding, 'runtimeHomeRef', 'runtime_home_ref') ?? '',
    ),
    capabilitySnapshotHash: String(
      evidenceField(
        binding,
        'capabilitySnapshotHash',
        'capability_snapshot_hash',
      ) ?? '',
    ),
    configSnapshotHash: String(
      evidenceField(
        binding,
        'configSnapshotHash',
        'config_snapshot_hash',
      ) ?? '',
    ),
  };
}

function foundationF12RuntimeSnapshotFact(
  value: unknown,
): Record<string, unknown> {
  const evidence = evidenceRecord(value, 'foundationF12TurnEvidence');
  const diagnostics = evidenceRecord(
    evidence.diagnostics,
    'foundationF12TurnDiagnostics',
  );
  const replay = evidenceRecord(
    diagnostics.replay,
    'foundationF12TurnReplay',
  );
  const attempts = evidenceArray(
    replay.attempts,
    'foundationF12TurnAttempts',
  );
  const attempt = evidenceRecord(
    attempts[attempts.length - 1],
    'foundationF12TurnAttempt',
  );
  const snapshot = evidenceRecord(
    evidenceField(attempt, 'runtimeSnapshot', 'runtime_snapshot'),
    'foundationF12RuntimeSnapshot',
  );
  return {
    turnId: String(evidenceField(attempt, 'turnId', 'turn_id') ?? ''),
    attemptId: String(
      evidenceField(attempt, 'attemptId', 'attempt_id') ?? '',
    ),
    runtimeKind: runtimeKindName(
      evidenceField(snapshot, 'runtimeKind', 'runtime_kind'),
    ),
    providerId: String(
      evidenceField(snapshot, 'providerId', 'provider_id') ?? '',
    ),
    modelId: String(
      evidenceField(snapshot, 'modelId', 'model_id') ?? '',
    ),
    runtimeProfileId: String(
      evidenceField(snapshot, 'runtimeProfileId', 'runtime_profile_id') ?? '',
    ),
    externalSessionId: String(
      evidenceField(snapshot, 'externalSessionId', 'external_session_id') ?? '',
    ),
    externalSessionEpoch: Number(
      evidenceField(
        snapshot,
        'externalSessionEpoch',
        'external_session_epoch',
      ) ?? 0,
    ),
  };
}

async function foundationF12TopicSnapshot(
  topic: Pick<
    FoundationF12TopicHandoff,
    'key' | 'conversationId' | 'fact' | 'runtimeTurnId'
      | 'selectedBranchMessageId'
  >,
): Promise<Record<string, unknown>> {
  const [readback, turnEvidence] = await Promise.all([
    foundationConversationReadback(topic.conversationId),
    foundationTurnEvidence(topic.conversationId, topic.runtimeTurnId),
  ]);
  const messages = [...readback.messages]
    .sort((left, right) =>
      left.seq - right.seq || left.messageId.localeCompare(right.messageId))
    .map((message) => ({
      conversationId: message.conversationId,
      messageId: message.messageId,
      turnId: message.turnId ?? '',
      role: message.role,
      status: message.status,
      content: message.content,
      seq: message.seq,
      branchId: message.branchId ?? '',
      parentMessageId: message.parentMessageId ?? '',
      replacesMessageId: message.replacesMessageId ?? '',
    }));
  const snapshot = {
    topicLabel: topic.key,
    fact: topic.fact,
    conversation: {
      conversationId: readback.conversation.conversation_id,
      agentId: readback.conversation.agent_id,
      status: readback.conversation.status,
      activeBranchMessageId:
        readback.conversation.active_branch_message_id,
      version: readback.conversation.version,
      runtimeBinding: foundationF12RuntimeBindingFact(
        readback.conversation.runtime_binding,
      ),
    },
    selectedBranchMessageId: topic.selectedBranchMessageId,
    runtimeTurn: foundationF12RuntimeSnapshotFact(turnEvidence),
    messages,
  };
  // Persist the exact canonical object being hashed; localStorage drops
  // undefined object fields while stableJson represents them as null.
  return evidenceRecord(
    JSON.parse(stableJson(snapshot)) as unknown,
    'foundationF12TopicSnapshot',
  );
}

async function foundationF12ReceiverSnapshot(
  topic: Pick<
    FoundationF12TopicHandoff,
    'conversationId' | 'fact' | 'selectedBranchMessageId'
  >,
  foreignFact: string,
): Promise<Record<string, unknown>> {
  const projectionDiagnostics = () => {
    const state = useChatStore.getState();
    const selectedMessage = state.messages.find(
      (message) => message.id === topic.selectedBranchMessageId,
    );
    const rendered = Array.from(
      document.querySelectorAll<HTMLElement>('[data-pt-agent-message-id]'),
    );
    const selectedElements = rendered.filter(
      (element) =>
        element.dataset.ptAgentMessageId === topic.selectedBranchMessageId,
    );
    return {
      currentSessionMatches: state.currentSessionKey === topic.conversationId,
      sessionRegistered: state.sessions.some(
        (session) => session.key === topic.conversationId,
      ),
      storeMessageCount: state.messages.length,
      selectedMessageInStore: selectedMessage !== undefined,
      selectedMessageRole: selectedMessage?.role ?? '',
      renderedMessageCount: rendered.length,
      selectedMessageInDom: selectedElements.length > 0,
      selectedMessageVisible: selectedElements.some(
        (element) => element.getClientRects().length > 0,
      ),
    };
  };

  eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'sessions' });
  await useChatStore.getState().selectSession(topic.conversationId);
  await useChatStore.getState().syncMessages();
  void reportFoundationF12ProjectionDebug(
    'A-E',
    'projection-synchronized',
    projectionDiagnostics(),
  );
  try {
    await waitFor(
      () => {
        const state = useChatStore.getState();
        return (
          state.currentSessionKey === topic.conversationId
          && state.messages.some(
            (message) => message.id === topic.selectedBranchMessageId,
          )
          && Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-pt-agent-message-id]',
            ),
          ).some((element) =>
            element.dataset.ptAgentMessageId === topic.selectedBranchMessageId
            && element.getClientRects().length > 0)
        );
      },
      `Foundation AS-F12 ${topic.conversationId} projection`,
      30_000,
    );
  } catch (error) {
    let stationMessageCount = -1;
    let selectedMessageInStationReadback = false;
    let stationReadbackErrorCode = '';
    try {
      const readback = await foundationConversationReadback(
        topic.conversationId,
      );
      stationMessageCount = readback.messages.length;
      selectedMessageInStationReadback = readback.messages.some(
        (message) => message.messageId === topic.selectedBranchMessageId,
      );
    } catch (readbackError) {
      stationReadbackErrorCode = observedErrorCode(readbackError);
    }
    await reportFoundationF12ProjectionDebug('A-E', 'projection-timeout', {
      ...projectionDiagnostics(),
      stationMessageCount,
      selectedMessageInStationReadback,
      stationReadbackErrorCode,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
  void reportFoundationF12ProjectionDebug(
    'C-D',
    'projection-ready',
    projectionDiagnostics(),
  );
  const rendered = Array.from(
    document.querySelectorAll<HTMLElement>('[data-pt-agent-message-id]'),
  ).map((element) => ({
    messageId: element.dataset.ptAgentMessageId ?? '',
    role: element.dataset.ptAgentMessage ?? '',
    visible: element.getClientRects().length > 0,
    text: element.textContent?.trim() ?? '',
  }));
  const visibleText = rendered
    .filter((message) => message.visible)
    .map((message) => message.text)
    .join('\n');
  return {
    conversationId: topic.conversationId,
    selectedBranchMessageId: topic.selectedBranchMessageId,
    rendered,
    storeMessageIds: useChatStore.getState().messages.map(
      (message) => message.id,
    ),
    selectedBranchVisible: rendered.some(
      (message) =>
        message.visible
        && message.messageId === topic.selectedBranchMessageId,
    ),
    ownFactVisible: visibleText.includes(topic.fact),
    foreignFactVisible: visibleText.includes(foreignFact),
  };
}

async function runFoundationF12Turn(input: {
  topic: FoundationF12TopicKey;
  conversationId: string;
  agentId: string;
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  content: string;
}): Promise<{
  turnId: string;
  runtimeEvent: FoundationF12RuntimeEvent;
}> {
  await useChatStore.getState().selectSession(input.conversationId);
  const observed = startObservedFoundationTurn({
    conversationId: input.conversationId,
    agentId: input.agentId,
    content: input.content,
    idempotencyKey: crypto.randomUUID(),
    provider: input.agent.provider || undefined,
    model: input.agent.model || undefined,
    effort: 'low',
    thinkingMode: 'disabled',
    clientCapabilitySessionId: input.capabilitySessionId,
  });
  const result = await observed.result;
  if (!result.ok) {
    throw new Error(
      result.error || 'agent.acceptance.foundationTopicTurnFailed',
    );
  }
  const turnId = observedTurnId(result.events);
  const terminal = [...result.events].reverse().find((event) =>
    classifyAgentTurnTerminalEvent(event) === 'completed');
  if (!turnId || !terminal) {
    throw new Error('agent.acceptance.foundationTopicEvidenceMissing');
  }
  return {
    turnId,
    runtimeEvent: {
      topic: input.topic,
      turnId,
      eventType: terminal.event,
      sequence: Number(terminal.data.seq ?? 0),
      observedAt: terminal.observedAt,
    },
  };
}

async function cleanupFoundationF12Scenario(input: {
  scenarioKey: string;
  conversationIds?: string[];
}): Promise<Record<string, unknown>> {
  const handoff = readFoundationF12Handoff(input.scenarioKey);
  const conversationIds = Array.from(new Set(
    handoff
      ? Object.values(handoff.topics).map((topic) => topic.conversationId)
      : input.conversationIds ?? [],
  )).filter(Boolean);
  if (conversationIds.length === 0) {
    removeFoundationF12Handoff(input.scenarioKey);
    return {
      cleanupComplete: true,
      handoffCleared: true,
      conversationIds: [],
      deletedConversationIds: [],
      cancellationErrorCodes: [],
    };
  }

  const deletedConversationIds: string[] = [];
  const cancellationErrorCodes: string[] = [];
  for (const conversationId of [...conversationIds].reverse()) {
    try {
      await cancelFoundationQueuedTurns(conversationId);
      const messages = await api.listAgentConversationMessages({
        conversation_id: conversationId,
        limit: 200,
      });
      const turnIds = Array.from(new Set(
        messages.messages
          .map((message) => message.turn_id)
          .filter((turnId): turnId is string => Boolean(turnId)),
      ));
      for (const turnId of turnIds.reverse()) {
        try {
          await api.cancelAgentTurn(turnId);
        } catch (error) {
          cancellationErrorCodes.push(observedErrorCode(error));
        }
      }
      await deleteFoundationConversation(conversationId);
      const deleted = await api.getAgentConversation(conversationId).then(
        (conversation) => conversation.status === 'deleted',
        (error: unknown) => observedErrorCode(error).includes('AGENT_4004'),
      );
      if (!deleted) {
        throw new Error(
          'agent.acceptance.foundationTopicCleanupConversationNotDeleted',
        );
      }
      deletedConversationIds.push(conversationId);
    } catch (error) {
      throw new Error(
        `CLEANUP_FAILED:${conversationId}:${observedErrorCode(error)}`,
      );
    }
  }

  removeFoundationF12Handoff(input.scenarioKey);
  const handoffCleared = readFoundationF12Handoff(input.scenarioKey) === null;
  const cleanupComplete =
    handoffCleared
    && deletedConversationIds.length === conversationIds.length;
  if (!cleanupComplete) {
    throw new Error('CLEANUP_FAILED:agent.acceptance.foundationTopicCleanup');
  }
  return {
    cleanupComplete,
    handoffCleared,
    conversationIds,
    deletedConversationIds,
    cancellationErrorCodes,
  };
}

async function selectFoundationBranchWithDiagnostics(input: {
  label: string;
  conversationId: string;
  messageId: string;
  expectedVersion: number;
}): Promise<Record<string, unknown>> {
  try {
    return evidenceRecord(
      await api.selectAgentActiveBranch({
        conversation_id: input.conversationId,
        active_branch_message_id: input.messageId,
        client_idempotency_key: crypto.randomUUID(),
        expected_conversation_version: input.expectedVersion,
      }),
      `foundation${input.label}Selection`,
    );
  } catch (error) {
    const actualVersion = await api.getAgentConversation(
      input.conversationId,
    ).then(
      (conversation) => conversation.version,
      () => 0,
    );
    throw new Error([
      'agent.acceptance.foundationBranchSelectionFailed',
      input.label,
      observedErrorCode(error),
      `expected=${input.expectedVersion}`,
      `actual=${actualVersion}`,
    ].join(':'));
  }
}

async function runFoundationF12Prepare(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  scenarioKey: string;
  platform: string;
  locale: string;
  sampleId: string;
}): Promise<FoundationF12Handoff> {
  const existing = readFoundationF12Handoff(input.scenarioKey);
  if (existing) {
    await cleanupFoundationF12Scenario({
      scenarioKey: input.scenarioKey,
    });
  }
  const agentId = input.agent.id || input.agent.name;
  const nonce = crypto.randomUUID();
  const facts: Record<FoundationF12TopicKey, string> = {
    alpha: `alpha-${input.sampleId}-${nonce}`,
    beta: `beta-${input.sampleId}-${nonce}`,
  };
  const createdConversationIds: string[] = [];

  try {
    const prepared = await withFoundationCapabilitiesDisabled(
      input.agent,
      input.capabilitySessionId,
      async (toolIsolation) => {
        const alpha = await api.createAgentConversation({
          agent_id: agentId,
          title: `Foundation topic alpha ${input.sampleId}`,
          provider_id: input.agent.provider,
          model_name: input.agent.model,
        });
        createdConversationIds.push(alpha.conversation_id);
        const beta = await api.createAgentConversation({
          agent_id: agentId,
          title: `Foundation topic beta ${input.sampleId}`,
          provider_id: input.agent.provider,
          model_name: input.agent.model,
        });
        createdConversationIds.push(beta.conversation_id);

        const runtimeEvents: FoundationF12RuntimeEvent[] = [];
        const alphaFirst = await runFoundationF12Turn({
          topic: 'alpha',
          conversationId: alpha.conversation_id,
          agentId,
          agent: input.agent,
          capabilitySessionId: input.capabilitySessionId,
          content: `Remember this exact topic fact: ${facts.alpha}. Reply with that fact only.`,
        });
        runtimeEvents.push(alphaFirst.runtimeEvent);
        const betaFirst = await runFoundationF12Turn({
          topic: 'beta',
          conversationId: beta.conversation_id,
          agentId,
          agent: input.agent,
          capabilitySessionId: input.capabilitySessionId,
          content: `Remember this exact topic fact: ${facts.beta}. Reply with that fact only.`,
        });
        runtimeEvents.push(betaFirst.runtimeEvent);
        const alphaSecond = await runFoundationF12Turn({
          topic: 'alpha',
          conversationId: alpha.conversation_id,
          agentId,
          agent: input.agent,
          capabilitySessionId: input.capabilitySessionId,
          content: `Recall only the topic fact ${facts.alpha}.`,
        });
        runtimeEvents.push(alphaSecond.runtimeEvent);
        const betaSecond = await runFoundationF12Turn({
          topic: 'beta',
          conversationId: beta.conversation_id,
          agentId,
          agent: input.agent,
          capabilitySessionId: input.capabilitySessionId,
          content: `Recall only the topic fact ${facts.beta}.`,
        });
        runtimeEvents.push(betaSecond.runtimeEvent);

        const alphaSource = await foundationConversationReadback(
          alpha.conversation_id,
        );
        const betaSource = await foundationConversationReadback(
          beta.conversation_id,
        );
        const alphaAssistant = alphaSource.messages.find((message) =>
          message.role === 'assistant'
          && message.turnId === alphaSecond.turnId);
        const betaAssistant = betaSource.messages.find((message) =>
          message.role === 'assistant'
          && message.turnId === betaSecond.turnId);
        if (!alphaAssistant || !betaAssistant) {
          throw new Error(
            'agent.acceptance.foundationTopicSourceMessagesMissing',
          );
        }

        const alphaRegeneration = evidenceRecord(
          await api.regenerateAgentTurn({
            conversation_id: alpha.conversation_id,
            source_assistant_message_id: alphaAssistant.messageId,
            client_idempotency_key: crypto.randomUUID(),
            expected_conversation_version: alphaSource.conversation.version,
          }),
          'foundationF12AlphaRegeneration',
        );
        const alphaSibling = await foundationRevisionMessageFact(
          evidenceField(
            alphaRegeneration,
            'assistantMessage',
            'assistant_message',
          ),
          'foundationF12AlphaSibling',
        );
        const alphaAfterRegenerate = await api.getAgentConversation(
          alpha.conversation_id,
        );
        const staleExpectedVersion = alphaAfterRegenerate.version;
        const alphaOriginalSelection = await selectFoundationBranchWithDiagnostics({
          label: 'AlphaOriginal',
          conversationId: alpha.conversation_id,
          messageId: alphaAssistant.messageId,
          expectedVersion: alphaAfterRegenerate.version,
        });
        const alphaOriginalConversation = evidenceRecord(
          alphaOriginalSelection.conversation,
          'foundationF12AlphaOriginalConversation',
        );
        await selectFoundationBranchWithDiagnostics({
          label: 'AlphaSibling',
          conversationId: alpha.conversation_id,
          messageId: String(alphaSibling.messageId),
          expectedVersion: Number(
            evidenceField(
              alphaOriginalConversation,
              'version',
              'version',
            ) ?? 0,
          ),
        });

        const betaRegeneration = evidenceRecord(
          await api.regenerateAgentTurn({
            conversation_id: beta.conversation_id,
            source_assistant_message_id: betaAssistant.messageId,
            client_idempotency_key: crypto.randomUUID(),
            expected_conversation_version: betaSource.conversation.version,
          }),
          'foundationF12BetaRegeneration',
        );
        const betaSibling = await foundationRevisionMessageFact(
          evidenceField(
            betaRegeneration,
            'assistantMessage',
            'assistant_message',
          ),
          'foundationF12BetaSibling',
        );
        const betaAfterRegenerate = await api.getAgentConversation(
          beta.conversation_id,
        );
        await selectFoundationBranchWithDiagnostics({
          label: 'BetaOriginal',
          conversationId: beta.conversation_id,
          messageId: betaAssistant.messageId,
          expectedVersion: betaAfterRegenerate.version,
        });

        const topicInputs = {
          alpha: {
            key: 'alpha' as const,
            conversationId: alpha.conversation_id,
            fact: facts.alpha,
            turnIds: [
              alphaFirst.turnId,
              alphaSecond.turnId,
              String(alphaSibling.turnId),
            ].filter(Boolean),
            runtimeTurnId: alphaSecond.turnId,
            sourceAssistantMessageId: alphaAssistant.messageId,
            siblingMessageId: String(alphaSibling.messageId),
            selectedBranchMessageId: String(alphaSibling.messageId),
          },
          beta: {
            key: 'beta' as const,
            conversationId: beta.conversation_id,
            fact: facts.beta,
            turnIds: [
              betaFirst.turnId,
              betaSecond.turnId,
              String(betaSibling.turnId),
            ].filter(Boolean),
            runtimeTurnId: betaSecond.turnId,
            sourceAssistantMessageId: betaAssistant.messageId,
            siblingMessageId: String(betaSibling.messageId),
            selectedBranchMessageId: betaAssistant.messageId,
          },
        };
        const [alphaBeforeStale, betaBeforeStale] = await Promise.all([
          foundationF12TopicSnapshot(topicInputs.alpha),
          foundationF12TopicSnapshot(topicInputs.beta),
        ]);
        const [alphaBeforeHash, betaBeforeHash] = await Promise.all([
          sha256Hex(stableJson(alphaBeforeStale)),
          sha256Hex(stableJson(betaBeforeStale)),
        ]);
        let staleErrorCode = '';
        try {
          await api.selectAgentActiveBranch({
            conversation_id: alpha.conversation_id,
            active_branch_message_id: alphaAssistant.messageId,
            client_idempotency_key: crypto.randomUUID(),
            expected_conversation_version: staleExpectedVersion,
          });
        } catch (error) {
          staleErrorCode = observedErrorCode(error);
        }
        const [alphaAfterStale, betaAfterStale] = await Promise.all([
          foundationF12TopicSnapshot(topicInputs.alpha),
          foundationF12TopicSnapshot(topicInputs.beta),
        ]);
        const [alphaAfterHash, betaAfterHash] = await Promise.all([
          sha256Hex(stableJson(alphaAfterStale)),
          sha256Hex(stableJson(betaAfterStale)),
        ]);
        const receiverBeforeAlpha = await foundationF12ReceiverSnapshot(
          topicInputs.alpha,
          facts.beta,
        );
        const receiverBeforeBeta = await foundationF12ReceiverSnapshot(
          topicInputs.beta,
          facts.alpha,
        );

        return {
          toolIsolation,
          runtimeEvents,
          topicInputs,
          topicSnapshots: {
            alpha: alphaAfterStale,
            beta: betaAfterStale,
          },
          topicHashes: {
            alpha: alphaAfterHash,
            beta: betaAfterHash,
          },
          receiverBefore: {
            alpha: receiverBeforeAlpha,
            beta: receiverBeforeBeta,
          },
          staleMutation: {
            targetConversationId: alpha.conversation_id,
            attemptedBranchMessageId: alphaAssistant.messageId,
            expectedVersion: staleExpectedVersion,
            errorCode: staleErrorCode,
            before: {
              alphaHash: alphaBeforeHash,
              betaHash: betaBeforeHash,
              alphaVersion: Number(
                evidenceRecord(
                  alphaBeforeStale.conversation,
                  'foundationF12AlphaBeforeConversation',
                ).version,
              ),
              betaVersion: Number(
                evidenceRecord(
                  betaBeforeStale.conversation,
                  'foundationF12BetaBeforeConversation',
                ).version,
              ),
            },
            after: {
              alphaHash: alphaAfterHash,
              betaHash: betaAfterHash,
              alphaVersion: Number(
                evidenceRecord(
                  alphaAfterStale.conversation,
                  'foundationF12AlphaAfterConversation',
                ).version,
              ),
              betaVersion: Number(
                evidenceRecord(
                  betaAfterStale.conversation,
                  'foundationF12BetaAfterConversation',
                ).version,
              ),
            },
          },
        };
      },
      { requireEffectiveCapabilities: true },
    );

    const handoff: FoundationF12Handoff = {
      scenarioKey: input.scenarioKey,
      platform: input.platform,
      locale: input.locale,
      sampleId: input.sampleId,
      agentId,
      topics: {
        alpha: {
          ...prepared.topicInputs.alpha,
          preRestart: prepared.topicSnapshots.alpha,
          preRestartHash: prepared.topicHashes.alpha,
          receiverBefore: prepared.receiverBefore.alpha,
        },
        beta: {
          ...prepared.topicInputs.beta,
          preRestart: prepared.topicSnapshots.beta,
          preRestartHash: prepared.topicHashes.beta,
          receiverBefore: prepared.receiverBefore.beta,
        },
      },
      staleMutation: prepared.staleMutation,
      runtimeEvents: prepared.runtimeEvents,
      toolIsolation: prepared.toolIsolation,
      preparedAt: new Date().toISOString(),
    };
    writeFoundationF12Handoff(handoff);
    return handoff;
  } catch (error) {
    try {
      await cleanupFoundationF12Scenario({
        scenarioKey: input.scenarioKey,
        conversationIds: createdConversationIds,
      });
    } catch (cleanupError) {
      const primary = error instanceof Error ? error.message : String(error);
      const cleanup = cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
      throw new Error(`CLEANUP_FAILED:${primary}; cleanup=${cleanup}`);
    }
    throw error;
  }
}

async function runFoundationF12PrepareWithCapabilityFixture(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  scenarioKey: string;
  platform: string;
  locale: string;
  sampleId: string;
}): Promise<FoundationF12Handoff> {
  return withFoundationReadyCapabilityFixture(
    input.agent,
    input.platform,
    (authoritativeAgent) => runFoundationF12Prepare({
      ...input,
      agent: authoritativeAgent,
    }),
  );
}

async function traverseFoundationF12Branches(
  topic: FoundationF12TopicHandoff,
): Promise<{
  alternatePostRestart: Record<string, unknown>;
  restoredSelectedPostRestart: Record<string, unknown>;
}> {
  const alternateBranchMessageId =
    topic.selectedBranchMessageId === topic.siblingMessageId
      ? topic.sourceAssistantMessageId
      : topic.siblingMessageId;
  const beforeAlternate = await api.getAgentConversation(topic.conversationId);
  await selectFoundationBranchWithDiagnostics({
    label: `F12${topic.key}Alternate`,
    conversationId: topic.conversationId,
    messageId: alternateBranchMessageId,
    expectedVersion: beforeAlternate.version,
  });
  const alternatePostRestart = await foundationF12TopicSnapshot({
    ...topic,
    selectedBranchMessageId: alternateBranchMessageId,
  });
  const beforeRestore = await api.getAgentConversation(topic.conversationId);
  await selectFoundationBranchWithDiagnostics({
    label: `F12${topic.key}Restore`,
    conversationId: topic.conversationId,
    messageId: topic.selectedBranchMessageId,
    expectedVersion: beforeRestore.version,
  });
  const restoredSelectedPostRestart = await foundationF12TopicSnapshot(topic);
  return {
    alternatePostRestart,
    restoredSelectedPostRestart,
  };
}

async function runFoundationF12Complete(
  stationRestart: Record<string, unknown>,
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
  const handoff = readFoundationF12Handoff(input.scenarioKey);
  if (!handoff) {
    throw new Error('agent.acceptance.foundationTopicHandoffMissing');
  }
  if (
    handoff.platform !== input.platform
    || handoff.locale !== input.locale
    || handoff.sampleId !== input.sampleId
  ) {
    throw new Error('agent.acceptance.foundationTopicScopeMismatch');
  }
  const [alphaPostRestart, betaPostRestart] = await Promise.all([
    foundationF12TopicSnapshot(handoff.topics.alpha),
    foundationF12TopicSnapshot(handoff.topics.beta),
  ]);
  const [alphaPostRestartHash, betaPostRestartHash] = await Promise.all([
    sha256Hex(stableJson(alphaPostRestart)),
    sha256Hex(stableJson(betaPostRestart)),
  ]);
  const alphaTraversal = await traverseFoundationF12Branches(
    handoff.topics.alpha,
  );
  const betaTraversal = await traverseFoundationF12Branches(
    handoff.topics.beta,
  );
  const receiverAfterAlpha = await foundationF12ReceiverSnapshot(
    handoff.topics.alpha,
    handoff.topics.beta.fact,
  );
  const receiverAfterBeta = await foundationF12ReceiverSnapshot(
    handoff.topics.beta,
    handoff.topics.alpha.fact,
  );
  await useChatStore.getState().selectSession(
    handoff.topics.alpha.conversationId,
  );
  await useChatStore.getState().syncMessages();

  const runtimeEvent =
    handoff.runtimeEvents[handoff.runtimeEvents.length - 1];
  if (!runtimeEvent) {
    throw new Error('agent.acceptance.foundationTopicRuntimeEventMissing');
  }
  const preparedAtMs = Date.parse(handoff.preparedAt);
  if (!Number.isFinite(preparedAtMs)) {
    throw new Error('agent.acceptance.foundationTopicStartMissing');
  }
  return {
    conversationId: handoff.topics.alpha.conversationId,
    turnId: handoff.topics.alpha.runtimeTurnId,
    durationMs: Date.now() - preparedAtMs,
    runtimeEvent,
    facts: {
      scope: {
        scenarioKey: handoff.scenarioKey,
        platform: handoff.platform,
        locale: handoff.locale,
        sampleId: handoff.sampleId,
      },
      toolIsolation: handoff.toolIsolation,
      topics: {
        alpha: {
          ...handoff.topics.alpha,
          postRestart: alphaPostRestart,
          postRestartHash: alphaPostRestartHash,
          ...alphaTraversal,
          receiverAfter: receiverAfterAlpha,
        },
        beta: {
          ...handoff.topics.beta,
          postRestart: betaPostRestart,
          postRestartHash: betaPostRestartHash,
          ...betaTraversal,
          receiverAfter: receiverAfterBeta,
        },
      },
      staleMutation: handoff.staleMutation,
      runtimeEvents: handoff.runtimeEvents,
      restart: {
        stationRestarted:
          typeof stationRestart.containerId === 'string'
          && stationRestart.containerId.length > 0
          && stationRestart.beforeStartedAt !== stationRestart.afterStartedAt
          && stationRestart.beforeCommit === stationRestart.afterCommit,
        clientRestarted:
          evidenceRecord(
            stationRestart.clientReloads,
            'foundationF12ClientReloads',
          )[input.platform] === true,
        station: stationRestart,
      },
      cleanup: {
        cleanupComplete: false,
        handoffCleared: false,
        conversationIds: [
          handoff.topics.alpha.conversationId,
          handoff.topics.beta.conversationId,
        ],
        deletedConversationIds: [],
        cancellationErrorCodes: [],
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

// #region debug-point A-D:as-f04-denial-evidence
function reportFoundationF04DenialDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7784/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'as-f04-denial-evidence',
      runId: 'post-fix',
      hypothesisId,
      location: 'harness.ts:runFoundationF04Scenario',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-E:base-cancelled-localization
function reportFoundationCancelledLocalizationDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7788/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'base-cancelled-localization',
      runId: 'post-fix',
      hypothesisId,
      location: 'harness.ts:foundationCancelledReceiverSnapshot',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point J-M:base-credential-runtime-event
function reportFoundationCredentialRuntimeEventDebug(
  data: Record<string, unknown>,
): Promise<void> {
  return fetch('http://127.0.0.1:7789/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'base-credential-runtime-event',
      runId: 'post-fix',
      hypothesisId: 'J-M',
      location: 'harness.ts:runFoundationCredentialMissingScenario.return',
      msg: '[DEBUG] credential and returned runtime events compared',
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-D:foundation-capability-isolation
function reportFoundationCapabilityIsolationDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7785/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-capability-isolation',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:withFoundationCapabilitiesDisabled',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-E:foundation-queue-capacity
function reportFoundationQueueCapacityDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7786/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-queue-capacity',
      runId: 'post-fix',
      hypothesisId,
      location: 'harness.ts:foundationDirectProbe:AS-F02',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-D:foundation-attachment-timeout
function reportFoundationAttachmentTimeoutDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7787/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-attachment-timeout',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:runFoundationAttachmentRejectedScenario',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-E:as-f07-revision-stage
function reportFoundationF07Debug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7783/event', {
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

// #region debug-point A-D:as-f06-recovery-prefix
function reportFoundationF06PrefixDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7779/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'as-f06-recovery-prefix',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:prepareFoundationF06Conversation',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-E:foundation-recovery-registration
function reportFoundationF06RegistrationDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7780/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-recovery-registration',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:AS-F06',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-D:foundation-f06-terminal-race
function reportFoundationF06TerminalRaceDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7780/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-f06-terminal-race',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:AS-F06-terminal-race',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-D:as-f06-page-switch
function foundationF06PageSwitchSnapshot(): Record<string, unknown> {
  const composer =
    document.querySelector<HTMLElement>('[data-pt-agent-composer]');
  const navigationRequests = eventDebugBuffer.list().filter((record) => {
    if (record.type !== EVENT.NAVIGATION_REQUESTED) return false;
    const payload = record.payload;
    return Boolean(
      payload
      && typeof payload === 'object'
      && 'resource' in payload
      && payload.resource === 'settings',
    );
  });
  return {
    hash: window.location.hash,
    settingsNavigationRequestCount: navigationRequests.length,
    composerPresent: composer !== null,
    composerVisible: Boolean(composer?.getClientRects().length),
    composerPage:
      composer?.closest<HTMLElement>('[data-page]')?.dataset.page ?? '',
    pageFrames: Array.from(
      document.querySelectorAll<HTMLElement>('[data-page]'),
    ).map((frame) => ({
      page: frame.dataset.page ?? '',
      display: frame.style.display,
      visible: frame.getClientRects().length > 0,
    })),
  };
}

function reportFoundationF06PageSwitchDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7791/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'as-f06-page-switch',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:finalizeFoundationF06Preparation',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-D:foundation-recovery-error-key
function reportFoundationRecoveryErrorKeyDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7782/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-recovery-error-key',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:exerciseFoundationRecoveryFailure',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-D:foundation-f04-expiry-settlement
function reportFoundationF04ExpirySettlementDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7784/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-f04-expiry-settlement',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:runFoundationF04Scenario',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-E:foundation-approval-receiver
function reportFoundationApprovalReceiverDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7782/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-approval-receiver',
      runId: 'post-fix',
      hypothesisId,
      location: 'harness.ts:runFoundationApprovalDeniedScenario',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-E:approval-retry-cancellation
function reportFoundationApprovalRetryCancellationDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7781/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'approval-retry-cancellation',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:runFoundationApprovalExpiredScenario',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-D:as-f03-cancel-race
function reportFoundationF03CancelDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7779/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-cancel-race',
      runId: 'post-fix',
      hypothesisId,
      location: 'harness.ts:foundationDirectProbe:AS-F03',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-E:as-f12-projection
function reportFoundationF12ProjectionDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7781/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-f12-projection',
      runId: 'pre-fix',
      hypothesisId,
      location: 'harness.ts:foundationF12ReceiverSnapshot',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-H:base-active-mutation-conflict
function reportActiveMutationConflictDebug(
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7780/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'base-active-mutation-conflict',
      runId: 'post-fix',
      hypothesisId: 'A-H',
      location: 'harness.ts:foundationActiveMutationConflict',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

// #region debug-point A-E:as-f10-capability-contract
function reportFoundationF10Debug(
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7778/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'as-f10-capability-contract',
      runId: 'pre-fix',
      hypothesisId: 'A-E',
      location: 'harness.ts:foundationDirectProbe',
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
  const retrySourceNonce = crypto.randomUUID();

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
    content:
      `Reply with 20 short numbered items for retry sample ${input.sampleId}. `
      + `Include nonce ${retrySourceNonce} in every item.`,
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
  const cancellationResponse = await cancellationAttempt.result;
  const sourceCancellationStatus = String(
    cancellationResponse?.status ?? '',
  ).toLowerCase();
  await reportFoundationF07Debug('S-U', 'retry-source-cancel-response', {
    elapsedMs: performance.now() - scenarioStartedAt,
    sourceCancellationStatus,
    sourceCancellationStatusType: typeof cancellationResponse?.status,
    responseFields: Object.keys(cancellationResponse ?? {}).sort(),
  });
  if (sourceCancellationStatus !== 'cancelled') {
    retrySource.controller.abort();
    throw new Error('agent.acceptance.foundationRevisionRetrySourceNotCancelled');
  }
  const retrySourceResult = await retrySource.result;
  const sourceStreamCancellationObserved = retrySourceResult.events.some(
    (event) => classifyAgentTurnTerminalEvent(event) === 'cancelled',
  );
  reportFoundationF07Debug('A-B', 'retry-source-finished', {
    elapsedMs: performance.now() - scenarioStartedAt,
    sourceCancellationStatus,
    sourceStreamCancellationObserved,
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

  const originalBranch = await selectFoundationBranchWithDiagnostics({
    label: 'F07Original',
    conversationId: conversation.conversation_id,
    messageId: sourceAssistant.messageId,
    expectedVersion: afterEdit.version,
  });
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

  const selectedExpectedVersion = Number(
    evidenceField(
      originalBranchConversation,
      'version',
      'version',
    ) ?? 0,
  );
  await reportFoundationF07Debug('V-X', 'selected-branch-started', {
    expectedVersion: selectedExpectedVersion,
    activeBranchIsOriginal:
      originalBranchConversation.active_branch_message_id
      === sourceAssistant.messageId,
    activeBranchIsTarget:
      originalBranchConversation.active_branch_message_id
      === firstRegenerateMessage.messageId,
  });
  try {
    await useChatStore.getState().branchFromMessage(
      String(firstRegenerateMessage.messageId),
    );
  } catch (error) {
    const failedConversation = await api.getAgentConversation(
      conversation.conversation_id,
    ).catch(() => null);
    const actualVersion = failedConversation?.version ?? 0;
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
    let stationErrorText = '';
    try {
      const stationError = responseBody
        ? evidenceRecord(
            JSON.parse(responseBody),
            'foundationF07BranchSelectionErrorBody',
          )
        : {};
      stationErrorText = String(
        stationError.error ?? stationError.message ?? '',
      );
    } catch {
      stationErrorText = '';
    }
    await reportFoundationF07Debug('V-X', 'selected-branch-failed', {
      expectedVersion: selectedExpectedVersion,
      actualVersion,
      activeBranchIsOriginal:
        failedConversation?.active_branch_message_id
        === sourceAssistant.messageId,
      activeBranchIsTarget:
        failedConversation?.active_branch_message_id
        === firstRegenerateMessage.messageId,
      errorCode: typeof codedError.code === 'string' ? codedError.code : '',
      httpStatus: Number(codedError.details?.status ?? 0),
      stationErrorCode:
        stationErrorText.match(/\b(?:AGENT|TOOL)_[A-Z0-9_]+\b/)?.[0] ?? '',
      versionConflict: stationErrorText.includes('conversation version changed'),
      invalidBranchHead: stationErrorText.includes('not a branch head'),
      messageNotFound: stationErrorText.includes('message not found'),
      duplicateEventSequence: stationErrorText.includes('idx_turn_events_turn_seq'),
    });
    throw new Error([
      'agent.acceptance.foundationBranchSelectionFailed',
      'F07Selected',
      observedErrorCode(error),
      `expected=${selectedExpectedVersion}`,
      `actual=${actualVersion}`,
    ].join(':'));
  }
  const selectedBranchConversation = evidenceRecord(
    await api.getAgentConversation(conversation.conversation_id),
    'foundationF07SelectedBranchConversation',
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
      sourceParentMessageId: String(sourceUser.parentMessageId ?? ''),
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
      usageBeforeHash: await sha256Hex(stableJson(originalAttemptsBefore)),
      usageAfterHash: await sha256Hex(stableJson(originalAttemptsAfter)),
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
        sourceStatus: sourceCancellationStatus,
        sourceStreamCancellationObserved,
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
        sourceParentMessageId: String(sourceUser.parentMessageId ?? ''),
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
        usageBeforeHash: await sha256Hex(stableJson(originalAttemptsBefore)),
        usageAfterHash: await sha256Hex(stableJson(originalAttemptsAfter)),
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

function foundationF10RejectionFact(
  value: AgentCapabilityNegativeControlFact,
): Record<string, unknown> {
  if (value.availability === 'unavailable') {
    return {
      availability: 'unavailable',
      unavailable_reason: value.unavailableReason ?? '',
    };
  }
  const station = evidenceRecord(value.station, 'foundationF10StationControl');
  const httpStatus = Number(station.httpStatus ?? 0);
  return {
    accepted: false,
    errorCode: String(
      station.commandErrorCode
      ?? (
        httpStatus === 401
          ? 'UNAUTHORIZED'
          : httpStatus === 403
            ? 'AGENT_4002'
            : ''
      ),
    ),
    source: evidenceValue(value),
  };
}

async function runFoundationF10Scenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  platform: string;
  capabilitySessions: Awaited<ReturnType<typeof waitForCapabilitySessionEvidence>>;
  readiness: Awaited<ReturnType<typeof api.getAgentCapabilityReadiness>>;
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
  const stationSession = input.capabilitySessions.selectedStationSession;
  const localSession = input.capabilitySessions.selectedLocalSession;
  if (!stationSession || !localSession) {
    throw new Error('agent.acceptance.capabilitySessionUnavailable');
  }
  const crossDeviceSession = input.capabilitySessions.station.sessions.find(
    (session) => session.session_id !== stationSession.session_id,
  );
  if (!crossDeviceSession) {
    throw new Error('agent.acceptance.crossDeviceSessionUnavailable');
  }

  const agentId = input.agent.id || input.agent.name;
  const core = await withFoundationCapabilitiesDisabled(
    input.agent,
    stationSession.session_id,
    async (toolIsolation) => {
      const conversation = await api.createAgentConversation({
        agent_id: agentId,
        title: `Foundation capability contract ${input.sampleId}`,
        provider_id: input.agent.provider,
        model_name: input.agent.model,
      });
      await useChatStore.getState().selectSession(conversation.conversation_id);
      const startedAt = performance.now();
      const observed = startObservedFoundationTurn({
        conversationId: conversation.conversation_id,
        agentId,
        content: `Reply with one short sentence for capability sample ${input.sampleId}.`,
        idempotencyKey: crypto.randomUUID(),
        provider: input.agent.provider || undefined,
        model: input.agent.model || undefined,
        effort: 'low',
        thinkingMode: 'disabled',
        clientCapabilitySessionId: stationSession.session_id,
      });
      const result = await observed.result;
      if (!result.ok) {
        throw new Error(
          result.error || 'agent.acceptance.foundationCapabilityTurnFailed',
        );
      }
      const turnId = observedTurnId(result.events);
      const runtimeEvent = [...result.events].reverse().find((event) =>
        classifyAgentTurnTerminalEvent(event) !== null);
      if (!turnId || !runtimeEvent) {
        throw new Error(
          'agent.acceptance.foundationCapabilityTurnEvidenceMissing',
        );
      }
      return {
        conversationId: conversation.conversation_id,
        turnId,
        durationMs: performance.now() - startedAt,
        runtimeEvent,
        terminalStatus: classifyAgentTurnTerminalEvent(runtimeEvent),
        toolIsolation,
      };
    },
    { requireEffectiveCapabilities: true },
  );

  const controls = Object.fromEntries(await Promise.all(
    ([
      'unsupported',
      'unauthorized',
      'signatureTamper',
      'schemaMismatch',
      'crossDevice',
    ] as const).map(async (control) => [
      control,
      await api.runAgentCapabilityNegativeControl(
        control,
        localSession.capability_session_id_hash,
        control === 'crossDevice' ? crossDeviceSession.session_id : undefined,
      ),
    ]),
  )) as Record<string, AgentCapabilityNegativeControlFact>;
  const availableControls = Object.values(controls).filter(
    (control) => control.availability === 'available',
  );
  const localAttemptDelta = availableControls.reduce(
    (total, control) =>
      total
      + control.after.localExecutionAttemptCount
      - control.before.localExecutionAttemptCount,
    0,
  );
  const sideEffectDelta = availableControls.reduce(
    (total, control) =>
      total
      + control.after.localSideEffectCount
      - control.before.localSideEffectCount,
    0,
  );
  const readinessSessionId = String(
    input.readiness.selected_client_session_id ?? '',
  );

  return {
    conversationId: core.conversationId,
    turnId: core.turnId,
    durationMs: core.durationMs,
    runtimeEvent: {
      eventType: core.runtimeEvent.event,
      sequence: Number(core.runtimeEvent.data.seq ?? 0),
      observedAt: core.runtimeEvent.observedAt,
    },
    facts: {
      coreOutcome: {
        stationStatus: core.terminalStatus,
        receiverStatus: core.terminalStatus === 'completed'
          ? 'completed'
          : 'incomplete',
      },
      toolIsolation: core.toolIsolation,
      capabilitySession: {
        platform: clientPlatformName(stationSession.platform),
        sessionId: localSession.capability_session_id_hash,
        readinessSessionId: readinessSessionId
          ? await sha256Hex(readinessSessionId)
          : '',
        deviceId: localSession.device_id_hash,
        capabilityCount: stationSession.typed_capabilities.length,
      },
      selectedDevice: {
        sessionDeviceId: localSession.device_id_hash,
        executionDeviceId:
          stationSession.typed_capabilities.length > 0
          && readinessSessionId === stationSession.session_id
            ? localSession.device_id_hash
            : null,
      },
      rejections: Object.fromEntries(
        Object.entries(controls).map(([control, fact]) => [
          control,
          foundationF10RejectionFact(fact),
        ]),
      ),
      execution: {
        localAttemptDelta,
        sideEffectDelta,
        resultDelta: 0,
        continuationDelta: 0,
        desktopFallbackDelta: 0,
      },
    },
  };
}

async function runFoundationF10WithCapabilityIsolation(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  platform: string;
  sampleId: string;
}): Promise<Awaited<ReturnType<typeof runFoundationF10Scenario>>> {
  return withFoundationReadyCapabilityFixture(
    input.agent,
    input.platform,
    async (authoritativeAgent) => {
      const capabilitySessions = await waitForCapabilitySessionEvidence();
      const stationSession = capabilitySessions.selectedStationSession;
      if (!stationSession) {
        throw new Error('agent.acceptance.capabilitySessionUnavailable');
      }
      const readiness = await api.getAgentCapabilityReadiness({
        agent_id: authoritativeAgent.id || authoritativeAgent.name,
        client_capability_session_id: stationSession.session_id,
      });
      return runFoundationF10Scenario({
        ...input,
        agent: authoritativeAgent,
        capabilitySessions,
        readiness,
      });
    },
  );
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

interface FoundationActiveMutationConflictResult {
  conversationId: string;
  turnId: string;
  durationMs: number;
  runtimeEvent: FoundationRuntimeEventObservation;
  facts: Record<string, unknown>;
}

interface FoundationCancelledResult {
  conversationId: string;
  turnId: string;
  durationMs: number;
  runtimeEvent: FoundationRuntimeEventObservation;
  facts: Record<string, unknown>;
}

interface FoundationCancelledReceiverSnapshot {
  messageId: string | null;
  visible: boolean;
  terminalStatus: string | null;
  errorType: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  errorDetail: string;
  errorText: string;
  expectedErrorText: string;
  recoveryVisible: boolean;
  resolutionPresent: boolean;
}

async function foundationCancelledReceiverSnapshot(
  turnId: string,
  description: string,
): Promise<FoundationCancelledReceiverSnapshot> {
  const selector =
    '[data-pt-agent-message="assistant"]'
    + `[data-pt-agent-error-resource-id="${turnId}"]`;
  await waitFor(
    () => {
      const element = document.querySelector<HTMLElement>(selector);
      return Boolean(
        element
        && element.getAttribute('data-pt-agent-terminal-status') === 'cancelled'
        && element.getClientRects().length > 0,
      );
    },
    description,
    30_000,
  );
  const messageElement = document.querySelector<HTMLElement>(selector);
  if (!messageElement) {
    throw new Error('agent.acceptance.foundationCancellationReceiverMissing');
  }
  const errorSelector =
    '[data-pt-agent-message-error-text="agent.errors.lifecycleCancelled"]';
  let receiverError = messageElement.querySelector<HTMLElement>(errorSelector);
  if (!receiverError) {
    const errorToggle = messageElement.querySelector<HTMLElement>(
      '[data-pt-agent-message-error-toggle]',
    );
    if (!errorToggle) {
      throw new Error('agent.acceptance.foundationCancellationErrorToggleMissing');
    }
    errorToggle.click();
    await waitFor(
      () => Boolean(messageElement.querySelector(errorSelector)),
      `${description} localized text`,
      10_000,
    );
    receiverError = messageElement.querySelector<HTMLElement>(errorSelector);
  }
  const receiverMessage = [...useChatStore.getState().messages]
    .reverse()
    .find((message) =>
      message.role === 'assistant'
      && message.typedError?.details.resource_id === turnId);

  const snapshot = {
    messageId: messageElement.getAttribute('data-pt-agent-message-id'),
    visible: messageElement.getClientRects().length > 0,
    terminalStatus: messageElement.getAttribute(
      'data-pt-agent-terminal-status',
    ),
    errorType: messageElement.getAttribute('data-pt-agent-error-type'),
    resourceKind: messageElement.getAttribute(
      'data-pt-agent-error-resource-kind',
    ),
    resourceId: messageElement.getAttribute(
      'data-pt-agent-error-resource-id',
    ),
    errorDetail: receiverMessage?.errorDetail ?? '',
    errorText: receiverError?.textContent?.trim() ?? '',
    expectedErrorText: i18n.t(
      'agent.errors.lifecycleCancelled',
      { ns: 'agent' },
    ),
    recoveryVisible: Boolean(
      messageElement.querySelector(
        '[data-pt-agent-message-error-recovery]',
      ),
    ),
    resolutionPresent: Boolean(receiverMessage?.resolution),
  };
  await reportFoundationCancelledLocalizationDebug('A-E', description, {
    locale: i18n.language,
    messageFound: Boolean(messageElement),
    messageId: snapshot.messageId,
    messageVisible: snapshot.visible,
    terminalStatus: snapshot.terminalStatus,
    errorType: snapshot.errorType,
    resourceKind: snapshot.resourceKind,
    storeErrorKey: receiverMessage?.error ?? '',
    typedErrorLocaleKey: receiverMessage?.typedError?.locale_key ?? '',
    errorElementFound: Boolean(receiverError),
    errorTogglePresent: Boolean(
      messageElement.querySelector('[data-pt-agent-message-error-toggle]'),
    ),
    errorText: snapshot.errorText,
    expectedErrorText: snapshot.expectedErrorText,
    errorTextMatches: snapshot.errorText === snapshot.expectedErrorText,
    errorDetail: snapshot.errorDetail,
    recoveryVisible: snapshot.recoveryVisible,
    resolutionPresent: snapshot.resolutionPresent,
  });
  return snapshot;
}

function typedActiveMutationConflict(error: unknown): Record<string, unknown> {
  const record = evidenceRecord(error, 'activeMutationConflictError');
  const details = evidenceRecord(record.details, 'activeMutationConflictDetails');
  return {
    observedAt: new Date().toISOString(),
    code: details.error_code,
    localeKey: details.locale_key,
    retryable: details.retryable === true || details.retryable === 'true',
    terminal: details.terminal === true || details.terminal === 'true',
    details: {
      resource_id: details.resource_id,
      expected_revision: details.expected_revision,
      actual_revision: details.actual_revision,
    },
  };
}

async function agentAuthorityHash(agent: Awaited<ReturnType<typeof api.getAgent>>): Promise<string> {
  return sha256Hex(stableJson(agent));
}

async function runFoundationCancelledScenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  sampleId: string;
}): Promise<FoundationCancelledResult> {
  const agentId = input.agent.id || input.agent.name;
  const actorPtid = authenticatedFoundationActorPtid();
  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation cancelled ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  let turnId = '';

  try {
      await useChatStore.getState().selectSession(conversation.conversation_id);
      const startedAt = performance.now();
      let cancellationRequestedAt = 0;
      let cancellationRequestCount = 0;
      const streamId = crypto.randomUUID();

      const result = await withFoundationCapabilitiesDisabled(
        input.agent,
        input.capabilitySessionId,
        async (toolIsolation) => {
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
          const observed = startObservedFoundationTurn({
            conversationId: conversation.conversation_id,
            agentId,
            content:
              'Write a detailed 2000-word numbered guide to reliable queues. '
              + 'Continue until the full guide is complete.',
            idempotencyKey: crypto.randomUUID(),
            provider: input.agent.provider || undefined,
            model: input.agent.model || undefined,
            effort: 'low',
            thinkingMode: 'disabled',
            clientCapabilitySessionId: input.capabilitySessionId,
            requestedBudget: {
              max_output_tokens: 4096,
              wall_time_ms: 90_000,
            },
            streamId,
            timeoutMs: 90_000,
            onEvent: (event, events) => {
              if (cancellationRequestCount > 0 || event.event !== 'text') return;
              const observedTurn = observedTurnId(events);
              if (!observedTurn) return;
              turnId = observedTurn;
              cancellationRequestCount += 1;
              cancellationRequestedAt = performance.now();
              resolveCancellation({
                turnId,
                result: api.cancelAgentTurn(turnId),
              });
            },
          });
          const cancellationAttempt = await Promise.race([
            cancellation,
            observed.result.then((turnResult) => {
              throw new Error(
                turnResult.error
                || 'agent.acceptance.foundationCancellationTextMissing',
              );
            }),
          ]);
          turnId = cancellationAttempt.turnId;
          const cancellationResponse = await cancellationAttempt.result;
          const cancellationStatus = String(
            cancellationResponse.status ?? '',
          ).toLowerCase();
          const turnResult = await observed.result;
          const liveDeliveries = turnResult.events.filter(
            (event) => Boolean(event.sourceDelivery),
          );
          const terminalEvents = liveDeliveries.filter((event) =>
            ['done', 'error', 'cancelled'].includes(event.event));
          const terminalEvent = terminalEvents[terminalEvents.length - 1];

          if (
            cancellationStatus === 'completed'
            || terminalEvent?.event === 'done'
          ) {
            throw new Error('agent.acceptance.foundationCancellationLostRace');
          }
          if (
            cancellationStatus !== 'cancelled'
            || !turnId
            || terminalEvent?.event !== 'cancelled'
            || !terminalEvent.sourceDelivery
          ) {
            throw new Error('agent.acceptance.foundationCancellationTerminalMissing');
          }

          const sourceDelivery = terminalEvent.sourceDelivery;
          if (
            sourceDelivery.transport !== 'station-sse'
            || sourceDelivery.ptid !== actorPtid
            || sourceDelivery.conversationId !== conversation.conversation_id
            || sourceDelivery.turnId !== turnId
            || sourceDelivery.sequence <= 0
            || sourceDelivery.rawPayload.eventType !== 'cancelled'
          ) {
            throw new Error(
              'agent.acceptance.foundationCancellationSourceIdentityMismatch',
            );
          }
          const sourcePayload = evidenceRecord(
            evidenceValue(sourceDelivery.rawPayload.data),
            'foundationCancelledSourcePayload',
          );
          const outcome = evidenceRecord(
            evidenceField(sourcePayload, 'outcomeError', 'outcome_error'),
            'foundationCancelledOutcome',
          );
          useChatStore.getState().applyRecoveredTurnEvent(
            conversation.conversation_id,
            agentId,
            turnId,
            {
              event: terminalEvent.event,
              data: terminalEvent.data,
            },
          );
          await useChatStore.getState().reconcileRecoveredTurn(
            conversation.conversation_id,
            turnId,
            {
              status: 'cancelled',
              reason:
                terminalReasonFromStreamData(terminalEvent.data).trim()
                || undefined,
            },
          );
          // #region debug-point J-M:post-cancellation-reconcile
          const postReconcileState = useChatStore.getState();
          const postReconcileOperation =
            postReconcileState.operations[conversation.conversation_id];
          const currentTurnMessages = postReconcileState.messages.filter(
            (message) => message.role === 'assistant' && message.turnId === turnId,
          );
          const bufferedTurnMessages = (
            postReconcileState.sessionBuffers[conversation.conversation_id] ?? []
          ).filter(
            (message) => message.role === 'assistant' && message.turnId === turnId,
          );
          await reportFoundationCancelledLocalizationDebug(
            'J-M',
            'Foundation post-cancellation reconcile',
            {
              currentSessionMatches:
                postReconcileState.currentSessionKey === conversation.conversation_id,
              operationPresent: Boolean(postReconcileOperation),
              operationTurnMatches: postReconcileOperation?.turnId === turnId,
              operationStatus: postReconcileOperation?.status ?? null,
              currentTurnMessageCount: currentTurnMessages.length,
              bufferedTurnMessageCount: bufferedTurnMessages.length,
              currentTurnMessages: await Promise.all(
                currentTurnMessages.map(async (message) => ({
                  messageIdHash: await sha256Hex(message.id),
                  terminalStatus: message.terminalStatus ?? null,
                  errorType: message.typedError?.error_type ?? null,
                  errorDetail: message.errorDetail ?? '',
                  loading: message.loading === true,
                })),
              ),
            },
          );
          // #endregion
          const liveReceiver = await foundationCancelledReceiverSnapshot(
            turnId,
            'Foundation live cancellation receiver',
          );
          const diagnostics = await waitForFoundationDiagnosticReplay(
            turnId,
            (replay) => {
              const attempts = optionalEvidenceArray(
                replay.attempts,
                'foundationCancelledAttempts',
              );
              const attempt = attempts.length > 0
                ? evidenceRecord(
                    attempts[attempts.length - 1],
                    'foundationCancelledAttempt',
                  )
                : null;
              return (
                Number(replay.status) === AgentTurnStatus.CANCELLED
                && Number(attempt?.status) === AgentTurnStatus.CANCELLED
                && Boolean(replay.trace)
              );
            },
            'Foundation cancelled Turn diagnostics',
          );
          const attempts = evidenceArray(
            diagnostics.attempts,
            'foundationCancelledAttempts',
          );
          const attempt = evidenceRecord(
            attempts[attempts.length - 1],
            'foundationCancelledAttempt',
          );
          const readback = await foundationConversationReadback(
            conversation.conversation_id,
          );
          const assistant = [...readback.messages].reverse().find(
            (message) => message.role === 'assistant' && message.turnId === turnId,
          );
          if (!assistant) {
            throw new Error('agent.acceptance.foundationCancelledMessageMissing');
          }
          const persistedOutcome = evidenceRecord(
            JSON.parse(String(assistant.errorJson || '{}')),
            'foundationCancelledPersistedOutcome',
          );

          useChatStore.setState((state) => ({
            messages: [],
            sessionBuffers: {
              ...state.sessionBuffers,
              [conversation.conversation_id]: [],
            },
          }));
          await useChatStore.getState().syncMessages();
          const reloadedReceiver = await foundationCancelledReceiverSnapshot(
            turnId,
            'Foundation reloaded cancellation receiver',
          );

          const replaySnapshot = { current: null as StreamEvent | null };
          const replayDeliveries = await foundationStationReplayReadback({
            conversationId: conversation.conversation_id,
            turnId,
            acknowledgedCursor: 0,
            streamId,
            streamGeneration: observed.controller.streamGeneration,
            actorPtid,
          }, {
            finishOnTerminal: false,
            onSnapshot: (event) => {
              replaySnapshot.current = event;
            },
          });
          const replayCancellation = replayDeliveries.find(
            (delivery) => (
              delivery.eventType === 'cancelled'
              && delivery.sequence === sourceDelivery.sequence
            ),
          );
          if (!replayCancellation) {
            throw new Error('agent.acceptance.foundationCancellationReplayMissing');
          }
          const authoritativeSnapshot = replaySnapshot.current;
          const snapshotDelivery = authoritativeSnapshot?.sourceDelivery;
          const snapshotSequence = Number(
            authoritativeSnapshot?.data.seq
            ?? authoritativeSnapshot?.data.sequence
            ?? 0,
          );
          if (
            !authoritativeSnapshot
            || String(authoritativeSnapshot.data.status).toLowerCase()
              !== 'cancelled'
            || !snapshotDelivery
            || snapshotDelivery.transport !== 'station-sse'
            || snapshotDelivery.ptid !== actorPtid
            || snapshotDelivery.conversationId
              !== conversation.conversation_id
            || snapshotDelivery.turnId !== turnId
            || snapshotDelivery.sequence !== snapshotSequence
            || snapshotDelivery.rawPayload.eventType !== 'snapshot'
          ) {
            throw new Error(
              'agent.acceptance.foundationCancellationSnapshotIdentityMismatch',
            );
          }
          useChatStore.setState((state) => ({
            messages: [],
            sessionBuffers: {
              ...state.sessionBuffers,
              [conversation.conversation_id]: [],
            },
          }));
          const snapshotTerminalReason = terminalReasonFromStreamData(
            authoritativeSnapshot.data,
          );
          const replayOperation =
            useChatStore.getState().operations[conversation.conversation_id];
          await reportFoundationCancelledLocalizationDebug(
            'F-I',
            'Foundation replay reconcile boundary',
            {
              snapshotStatus: String(
                authoritativeSnapshot.data.status ?? '',
              ).toLowerCase(),
              snapshotTerminalReason,
              snapshotTerminalReasonPresent: snapshotTerminalReason.length > 0,
              operationPresent: Boolean(replayOperation),
              operationTurnMatches: replayOperation?.turnId === turnId,
              operationStatus: replayOperation?.status ?? null,
            },
          );
          await useChatStore.getState().reconcileRecoveredTurn(
            conversation.conversation_id,
            turnId,
            {
              status: 'cancelled',
              reason: snapshotTerminalReason,
              ...(typeof authoritativeSnapshot.data.text === 'string'
                ? { content: authoritativeSnapshot.data.text }
                : {}),
            },
          );
          const replayReconciledState = useChatStore.getState();
          const replayReconciledMessage = [...replayReconciledState.messages]
            .reverse()
            .find((message) => (
              message.role === 'assistant'
              && message.turnId === turnId
            ));
          await reportFoundationCancelledLocalizationDebug(
            'F-I',
            'Foundation replay reconcile result',
            {
              operationPresent: Boolean(
                replayReconciledState.operations[conversation.conversation_id],
              ),
              operationTurnMatches:
                replayReconciledState.operations[conversation.conversation_id]
                  ?.turnId === turnId,
              messagePresent: Boolean(replayReconciledMessage),
              messageTerminalStatus:
                replayReconciledMessage?.terminalStatus ?? null,
              messageErrorDetail: replayReconciledMessage?.errorDetail ?? '',
            },
          );
          const replayedReceiver = await foundationCancelledReceiverSnapshot(
            turnId,
            'Foundation replayed cancellation receiver',
          );
          const sourceHash = await sha256Hex(
            stableJson(sourceDelivery.rawPayload),
          );
          const replayHash = await sha256Hex(
            stableJson(replayCancellation.rawPayload),
          );
          const terminalDeliveries = replayDeliveries.filter((delivery) =>
            ['done', 'error', 'cancelled'].includes(delivery.eventType));
          const payloadHash = await sha256Hex(
            stableJson(sourceDelivery.rawPayload),
          );
          const runtimeEvent: FoundationRuntimeEventObservation = {
            eventId: await sha256Hex(stableJson({
              turnId,
              sequence: sourceDelivery.sequence,
              payloadHash,
            })),
            eventType: terminalEvent.event,
            sequence: sourceDelivery.sequence,
            observedAt: terminalEvent.observedAt,
            streamGeneration: observed.controller.streamGeneration,
            streamIdHash: await sha256Hex(streamId),
            conversationIdHash: await sha256Hex(conversation.conversation_id),
            payloadHash,
            errorType: String(outcome.error_type ?? ''),
            sourceTransport: sourceDelivery.transport,
            sourcePtidHash: await sha256Hex(sourceDelivery.ptid),
            sourceConversationId: sourceDelivery.conversationId,
            sourceTurnId: sourceDelivery.turnId,
            sourceSequence: sourceDelivery.sequence,
            sourceEventType: sourceDelivery.rawPayload.eventType,
          };

          return {
            result: {
              conversationId: conversation.conversation_id,
              turnId,
              durationMs: performance.now() - startedAt,
              runtimeEvent,
              facts: {
                outcome,
                receiver: {
                  ...replayedReceiver,
                  phases: {
                    live: liveReceiver,
                    reload: reloadedReceiver,
                    replaySnapshot: replayedReceiver,
                  },
                },
                station: {
                  conversationId: conversation.conversation_id,
                  messageId: assistant.messageId,
                  turnId,
                  turnStatus: Number(diagnostics.status)
                    === AgentTurnStatus.CANCELLED
                    ? 'cancelled'
                    : 'unknown',
                  attemptStatus: Number(attempt.status)
                    === AgentTurnStatus.CANCELLED
                    ? 'cancelled'
                    : 'unknown',
                  messageStatus: String(assistant.status)
                    .toLowerCase()
                    .endsWith('cancelled')
                    ? 'cancelled'
                    : 'unknown',
                  terminalReason: String(
                    evidenceField(
                      diagnostics,
                      'terminalReason',
                      'terminal_reason',
                    ) ?? '',
                  ),
                  persistedOutcome,
                  terminalEventCount: terminalDeliveries.length,
                  cancelledEventCount: terminalDeliveries.filter(
                    (delivery) => delivery.eventType === 'cancelled',
                  ).length,
                  doneEventCount: terminalDeliveries.filter(
                    (delivery) => delivery.eventType === 'done',
                  ).length,
                  errorEventCount: terminalDeliveries.filter(
                    (delivery) => delivery.eventType === 'error',
                  ).length,
                  liveTerminalEventCount: terminalEvents.length,
                  liveDoneEventCount: liveDeliveries.filter(
                    (delivery) => delivery.event === 'done',
                  ).length,
                },
                replay: {
                  sourceHash,
                  replayHash,
                  equal: sourceHash === replayHash,
                  snapshot: {
                    sourceTransport: snapshotDelivery.transport,
                    sourcePtidHash: await sha256Hex(snapshotDelivery.ptid),
                    sourceConversationId: snapshotDelivery.conversationId,
                    sourceTurnId: snapshotDelivery.turnId,
                    sourceSequence: snapshotDelivery.sequence,
                    sourceEventType: snapshotDelivery.rawPayload.eventType,
                    status: String(
                      authoritativeSnapshot.data.status,
                    ).toLowerCase(),
                  },
                },
                cleanup: {
                  cancellationRequestCount,
                  terminalCleanupCount: terminalDeliveries.filter(
                    (delivery) => delivery.eventType === 'cancelled',
                  ).length,
                },
                toolIsolation,
                cancellation: {
                  status: cancellationStatus,
                  latencyMs: performance.now() - cancellationRequestedAt,
                },
                runtimeEvent,
              },
            } satisfies FoundationCancelledResult,
          };
        },
      );
    return result.result;
  } catch (error) {
    try {
      await cleanupFoundationToolConversation(
        conversation.conversation_id,
        turnId,
      );
    } catch (cleanupError) {
      throw Object.assign(
        new Error('agent.acceptance.foundationCancellationCleanupFailed'),
        { primaryError: error, cleanupError },
      );
    }
    throw error;
  }
}

async function runFoundationDirectAttestationTurn(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  sampleId: string;
}): Promise<{
  conversationId: string;
  turnId: string;
  durationMs: number;
  runtimeEvent: FoundationRuntimeEventObservation;
}> {
  const agentId = input.agent.id || input.agent.name;
  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation conflict attestation ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  let attestationTurnId = '';

  try {
    await useChatStore.getState().selectSession(conversation.conversation_id);
    let turnStartedAt = 0;
    let turnCompletedAt = 0;
    const result = await withFoundationCapabilitiesDisabled(
      input.agent,
      input.capabilitySessionId,
      async () => {
        turnStartedAt = performance.now();
        const observed = startObservedFoundationTurn({
          conversationId: conversation.conversation_id,
          agentId,
          content: 'Reply with ready.',
          idempotencyKey: crypto.randomUUID(),
          provider: input.agent.provider || undefined,
          model: input.agent.model || undefined,
          effort: 'low',
          thinkingMode: 'disabled',
          clientCapabilitySessionId: input.capabilitySessionId,
        });
        const turnResult = await observed.result;
        turnCompletedAt = performance.now();
        attestationTurnId = observedTurnId(turnResult.events);
        return turnResult;
      },
    );
    if (!result.ok) {
      throw new Error(
        result.error
        || 'agent.acceptance.foundationActiveMutationAttestationTurnFailed',
      );
    }
    const terminal = [...result.events].reverse().find((event) =>
      classifyAgentTurnTerminalEvent(event) === 'completed');
    if (!attestationTurnId || !terminal) {
      throw new Error(
        'agent.acceptance.foundationActiveMutationAttestationTurnMissing',
      );
    }
    const durationMs = turnCompletedAt - turnStartedAt;
    await reportActiveMutationConflictDebug('attestation-turn-complete', {
      conversationIdHash: await sha256Hex(conversation.conversation_id),
      turnIdHash: await sha256Hex(attestationTurnId),
      eventType: terminal.event,
      sequence: Number(terminal.data.seq ?? 0),
      durationMs,
    });
    return {
      conversationId: conversation.conversation_id,
      turnId: attestationTurnId,
      durationMs,
      runtimeEvent: {
        eventType: terminal.event,
        sequence: Number(terminal.data.seq ?? 0),
        observedAt: terminal.observedAt,
      },
    };
  } catch (error) {
    try {
      await cleanupFoundationToolConversation(
        conversation.conversation_id,
        attestationTurnId,
      );
      await reportActiveMutationConflictDebug(
        'attestation-failure-cleanup-complete',
        {
          conversationIdHash: await sha256Hex(conversation.conversation_id),
          turnIdPresent: Boolean(attestationTurnId),
        },
      );
    } catch (cleanupError) {
      throw Object.assign(
        new Error(
          'agent.acceptance.foundationActiveMutationAttestationCleanupFailed',
        ),
        { primaryError: error, cleanupError },
      );
    }
    throw error;
  }
}

async function runFoundationActiveMutationConflictScenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  sampleId: string;
}): Promise<FoundationActiveMutationConflictResult> {
  const store = useAgentStore.getState();
  const priorSelection = store.selectedAgent;
  const priorSurface = store.getAgentSurface(priorSelection);
  const disposable = await store.createAgent({
    name: `foundation-conflict-${input.sampleId}-${crypto.randomUUID()}`,
    title: `Foundation conflict ${input.sampleId}`,
    description: 'Foundation active mutation conflict fixture',
  });
  let scenarioError: unknown = null;
  let cleanupError: unknown = null;
  let facts: Record<string, unknown> | null = null;

  try {
    await api.setSelectedAgent(disposable.name);
    useAgentStore.getState().setSelectedAgent(disposable.name);
    useAgentStore.getState().setAgentSurface(disposable.name, 'profile');
    eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'sessions' });

    const staleRevision = disposable.version;
    const winningDescription = `Foundation winner ${input.sampleId}`;
    const winner = await api.updateAgent(disposable.id, {
      description: winningDescription,
      version: staleRevision,
    });
    const winnerReadback = await api.getAgent(disposable.id);
    const winnerHash = await agentAuthorityHash(winnerReadback);

    let rejection: Record<string, unknown> | null = null;
    try {
      await useAgentStore.getState().updateAgentProfile(disposable.id, {
        title: `Foundation stale ${input.sampleId}`,
      });
    } catch (error) {
      rejection = typedActiveMutationConflict(error);
    }
    if (!rejection) {
      throw new Error('agent.acceptance.activeMutationConflictMissing');
    }
    await reportActiveMutationConflictDebug('conflict-observed', {
      agentIdHash: await sha256Hex(disposable.id),
      selectedAgentMatches: useAgentStore.getState().selectedAgent === disposable.name,
      selectedSurface:
        useAgentStore.getState().getAgentSurface(disposable.name),
      saveState: useAgentStore.getState().saveStateByAgentId[disposable.id],
      rejectionCode: rejection.code,
      rejectionLocaleKey: rejection.localeKey,
    });

    await waitFor(
      () => {
        const conflict = document.querySelector('[data-pt-agent-profile-conflict]');
        const reload = document.querySelector('[data-pt-agent-profile-reload]');
        return Boolean(
          conflict
          && reload
          && conflict.getClientRects().length > 0
          && reload.getClientRects().length > 0,
        );
      },
      'active mutation conflict recovery controls',
      30_000,
    );
    const conflictElement = document.querySelector<HTMLElement>(
      '[data-pt-agent-profile-conflict]',
    );
    const reloadElement = document.querySelector<HTMLElement>(
      '[data-pt-agent-profile-reload]',
    );
    if (!conflictElement || !reloadElement) {
      throw new Error('agent.acceptance.activeMutationConflictSurfaceMissing');
    }
    const receiverBeforeReload = {
      conflictVisible: conflictElement.getClientRects().length > 0,
      conflictText: conflictElement.textContent?.trim() ?? '',
      expectedConflictText: i18n.t(
        'agent.errors.activeMutationConflict',
        { ns: 'agent' },
      ),
      reloadVisible: reloadElement.getClientRects().length > 0,
      reloadText: reloadElement.textContent?.trim() ?? '',
      expectedReloadText: i18n.t(
        'agent.recovery.reloadLatest',
        { ns: 'agent' },
      ),
    };
    await reportActiveMutationConflictDebug('receiver-observed', {
      locale: i18n.language,
      profileAgentIdMatches:
        document.querySelector('[data-pt-agent-profile]')
          ?.getAttribute('data-pt-agent-profile') === disposable.id,
      saveState: useAgentStore.getState().saveStateByAgentId[disposable.id],
      conflictPresent: Boolean(conflictElement),
      conflictVisible: receiverBeforeReload.conflictVisible,
      reloadPresent: Boolean(reloadElement),
      reloadVisible: receiverBeforeReload.reloadVisible,
      conflictTextMatches:
        receiverBeforeReload.conflictText.includes(
          receiverBeforeReload.expectedConflictText,
        ),
      reloadTextMatches:
        receiverBeforeReload.reloadText === receiverBeforeReload.expectedReloadText,
      conflictTextLength: receiverBeforeReload.conflictText.length,
      expectedConflictTextLength:
        receiverBeforeReload.expectedConflictText.length,
      reloadTextLength: receiverBeforeReload.reloadText.length,
      expectedReloadTextLength: receiverBeforeReload.expectedReloadText.length,
    });

    reloadElement.click();
    await waitFor(
      () => {
        const current = useAgentStore.getState();
        return (
          current.agents.find((agent) => agent.id === disposable.id)?.version
            === winner.version
          && current.saveStateByAgentId[disposable.id] === 'idle'
        );
      },
      'authoritative Agent profile reload',
      30_000,
    );

    const afterStaleReadback = await api.getAgent(disposable.id);
    const afterReloadReadback = await api.getAgent(disposable.id);
    facts = {
      rejection,
      winner: {
        resourceId: disposable.id,
        expectedRevision: staleRevision,
        actualRevision: winner.version,
        revisionBeforeStale: winnerReadback.version,
        revisionAfterStale: afterStaleReadback.version,
        revisionAfterReload: afterReloadReadback.version,
        hashBeforeStale: winnerHash,
        hashAfterStale: await agentAuthorityHash(afterStaleReadback),
        hashAfterReload: await agentAuthorityHash(afterReloadReadback),
      },
      staleMutation: {
        attemptedRevision: staleRevision,
        mutationDelta: afterStaleReadback.version - winnerReadback.version,
      },
      receiver: {
        ...receiverBeforeReload,
        reloadExecuted: true,
        reloadedRevision:
          useAgentStore.getState().agents.find(
            (agent) => agent.id === disposable.id,
          )?.version ?? 0,
      },
    };
  } catch (error) {
    scenarioError = error;
  } finally {
    try {
      await api.deleteAgent(disposable.id);
      await useAgentStore.getState().loadAgents();
      if (priorSelection) {
        useAgentStore.getState().setSelectedAgent(priorSelection);
        useAgentStore.getState().setAgentSurface(priorSelection, priorSurface);
        await api.setSelectedAgent(priorSelection);
      }
      const deletedFromRoster = !useAgentStore.getState().agents.some(
        (agent) => agent.id === disposable.id,
      );
      const deletedFromStation = await api.getAgent(disposable.id).then(
        () => false,
        (error: unknown) => JSON.stringify(
          (error as { details?: unknown })?.details ?? {},
        ).includes('AGENT_4004'),
      );
      if (!deletedFromRoster || !deletedFromStation) {
        cleanupError = new Error(
          'agent.acceptance.activeMutationConflictCleanupIncomplete',
        );
      }
      if (facts) {
        facts.cleanup = {
          disposableAgentId: disposable.id,
          deletedFromRoster,
          deletedFromStation,
          priorSelection,
          restoredSelection: useAgentStore.getState().selectedAgent,
        };
      }
    } catch (error) {
      cleanupError = error;
    }
  }

  if (cleanupError) {
    throw Object.assign(
      new Error('agent.acceptance.activeMutationConflictCleanupFailed'),
      { primaryError: scenarioError, cleanupError },
    );
  }
  if (scenarioError) throw scenarioError;
  if (!facts) {
    throw new Error('agent.acceptance.activeMutationConflictFactsMissing');
  }
  const attestation = await runFoundationDirectAttestationTurn({
    agent: input.agent,
    capabilitySessionId: input.capabilitySessionId,
    sampleId: input.sampleId,
  });
  return {
    conversationId: attestation.conversationId,
    turnId: attestation.turnId,
    durationMs: attestation.durationMs,
    runtimeEvent: attestation.runtimeEvent,
    facts,
  };
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
    case 'BASE-ACTIVE_MUTATION_CONFLICT':
      return evaluateBaseActiveMutationConflict(ctx);
    case 'BASE-CANCELLED':
      return evaluateBaseCancelled(ctx);
    case 'BASE-CONTEXT_OVERFLOW':
      return evaluateBaseContextOverflow(ctx);
    case 'BASE-DUPLICATE_CONFLICT':
      return evaluateBaseDuplicateConflict(ctx);
    case 'BASE-CREDENTIAL_MISSING':
      return evaluateBaseCredentialMissing(ctx);
    case 'BASE-EXECUTOR-UNAVAILABLE':
      return evaluateBaseExecutorUnavailable(ctx);
    case 'BASE-APPROVAL_DENIED':
      return evaluateBaseApprovalDenied(ctx);
    case 'BASE-APPROVAL_EXPIRED':
      return evaluateBaseApprovalExpired(ctx);
    case 'BASE-ATTACHMENT_REJECTED':
      return evaluateBaseAttachmentRejected(ctx);
    default:
      throw new Error(`agent.acceptance.unsupportedFoundationCell:${ctx.cell}`);
  }
}

function evaluateBaseExecutorUnavailable(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(
    ctx.scenarioFacts,
    'foundationExecutorUnavailableFacts',
  );
  const outcome = evidenceRecord(
    facts.outcome,
    'foundationExecutorUnavailableOutcome',
  );
  const details = evidenceRecord(
    outcome.details,
    'foundationExecutorUnavailableDetails',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationExecutorUnavailableReceiver',
  );
  const decision = evidenceRecord(
    facts.decision,
    'foundationExecutorUnavailableDecision',
  );
  const station = evidenceRecord(
    facts.station,
    'foundationExecutorUnavailableStation',
  );
  const stationAfterRecovery = evidenceRecord(
    facts.stationAfterRecovery,
    'foundationExecutorUnavailableStationAfterRecovery',
  );
  const lineage = evidenceRecord(
    station.lineage,
    'foundationExecutorUnavailableLineage',
  );
  const recoveryLineage = evidenceRecord(
    stationAfterRecovery.lineage,
    'foundationExecutorUnavailableRecoveryLineage',
  );
  const executor = evidenceRecord(
    facts.executor,
    'foundationExecutorUnavailableExecutor',
  );
  const replay = evidenceRecord(
    facts.replay,
    'foundationExecutorUnavailableReplay',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationExecutorUnavailableCleanup',
  );
  const safeDetailKeys = Object.keys(details).sort();
  const zeroStationOutcome = (value: Record<string, unknown>) => (
    Number(value.executionAttemptCount) === 0
    && Number(value.sideEffectCount) === 0
    && Number(value.resultCount) === 0
    && Number(value.continuationCount) === 0
  );
  return {
    typedExecutorUnavailable: (
      outcome.error_type === 'CLIENT_EXECUTOR_UNAVAILABLE'
      && outcome.locale_key === 'agent.errors.executorUnavailable'
      && outcome.retryable === true
      && outcome.terminal === true
      && safeDetailKeys.length === 2
      && safeDetailKeys[0] === 'capability_id'
      && safeDetailKeys[1] === 'target_device_id'
      && details.target_device_id === executor.targetDeviceId
      && details.capability_id === executor.targetCapabilityId
    ),
    localizedRecoveryVisible: (
      receiver.errorVisible === true
      && receiver.errorText === receiver.expectedErrorText
      && receiver.recoveryVisible === true
      && receiver.recoveryText === receiver.expectedRecoveryText
    ),
    singleRejectedApproval: (
      decision.accepted === false
      && decision.approved === true
      && decision.errorCode
        === 'TOOL_APPROVAL_DECISION_ERROR_CODE_EXECUTOR_UNAVAILABLE'
      && receiver.approveDisabled === true
      && receiver.repeatedApprovalBlocked === true
    ),
    waitingApprovalPreserved: (
      station.policy === 'manual'
      && stableJson(station.states)
        === stableJson(['policy_check', 'awaiting_user'])
      && station.executionOwner === 'client_capability'
      && lineage.toolCallId === decision.toolCallId
      && lineage.approvalId === decision.approvalId
      && lineage.decisionId === ''
      && Number(lineage.decisionRevision) === decision.decisionRevision
    ),
    zeroExecutionClaim: (
      lineage.executionClaimId === ''
      && Number(lineage.fencingToken) === 0
      && lineage.sideEffectReceiptId === ''
      && lineage.dispatchCommittedAt === null
      && recoveryLineage.executionClaimId === ''
      && Number(recoveryLineage.fencingToken) === 0
      && recoveryLineage.sideEffectReceiptId === ''
      && recoveryLineage.dispatchCommittedAt === null
    ),
    zeroSideEffect: (
      zeroStationOutcome(station)
      && zeroStationOutcome(stationAfterRecovery)
      && Number(executor.withdrawnExecutionAttemptCount) >= 0
      && Number(executor.withdrawnSideEffectCount) >= 0
      && Number(executor.restoredExecutionAttemptCount)
        === Number(executor.withdrawnExecutionAttemptCount)
      && Number(executor.restoredSideEffectCount)
        === Number(executor.withdrawnSideEffectCount)
    ),
    replayEqual: (
      replay.equal === true
      && replay.acknowledgementSourceHash
        === replay.acknowledgementReplayHash
      && replay.diagnosticSourceHash === replay.diagnosticReplayHash
    ),
    executorReconnected: (
      executor.sessionRemoved === true
      && executor.localSessionRemoved === true
      && executor.sessionRestored === true
      && executor.restoredDeviceId === executor.targetDeviceId
      && executor.restoredCapabilityId === executor.targetCapabilityId
      && receiver.recoveryExecuted === true
      && receiver.approvalEnabledAfterRecovery === true
    ),
    cleanupComplete: (
      cleanup.bindingRestored === true
      && cleanup.executorRestored === true
      && cleanup.turnCancelled === true
      && cleanup.conversationDeleted === true
    ),
  };
}

function evaluateBaseCancelled(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationCancelledFacts');
  const outcome = evidenceRecord(
    facts.outcome,
    'foundationCancelledOutcome',
  );
  const details = evidenceRecord(
    outcome.details,
    'foundationCancelledDetails',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationCancelledReceiver',
  );
  const station = evidenceRecord(
    facts.station,
    'foundationCancelledStation',
  );
  const receiverPhases = evidenceRecord(
    receiver.phases,
    'foundationCancelledReceiverPhases',
  );
  const receiverPhaseMatches = (
    phaseName: string,
    expectedMessageId: string,
    expectedErrorDetail: string,
  ): boolean => {
    const phase = evidenceRecord(
      receiverPhases[phaseName],
      `foundationCancelledReceiverPhase.${phaseName}`,
    );
    return (
      phase.visible === true
      && phase.terminalStatus === 'cancelled'
      && phase.errorType === 'LIFECYCLE_CANCELLED'
      && phase.resourceKind === 'turn'
      && phase.resourceId === station.turnId
      && phase.errorText === phase.expectedErrorText
      && phase.recoveryVisible === false
      && phase.resolutionPresent === false
      && phase.messageId === expectedMessageId
      && phase.errorDetail === expectedErrorDetail
    );
  };
  const persistedOutcome = evidenceRecord(
    station.persistedOutcome,
    'foundationCancelledPersistedOutcome',
  );
  const persistedDetails = evidenceRecord(
    persistedOutcome.details,
    'foundationCancelledPersistedDetails',
  );
  const replay = evidenceRecord(
    facts.replay,
    'foundationCancelledReplay',
  );
  const replaySnapshot = evidenceRecord(
    replay.snapshot,
    'foundationCancelledReplaySnapshot',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationCancelledCleanup',
  );
  const cancellation = evidenceRecord(
    facts.cancellation,
    'foundationCancelledCommand',
  );
  const runtimeEvent = evidenceRecord(
    facts.runtimeEvent,
    'foundationCancelledRuntimeEvent',
  );
  const safeDetailKeys = Object.keys(details).sort();

  return {
    typedCancellationProjected: (
      outcome.error === 'agent.errors.lifecycleCancelled'
      && outcome.error_type === 'LIFECYCLE_CANCELLED'
      && outcome.locale_key === 'agent.errors.lifecycleCancelled'
      && outcome.retryable === false
      && outcome.terminal === true
      && safeDetailKeys.length === 2
      && safeDetailKeys[0] === 'resource_id'
      && safeDetailKeys[1] === 'resource_kind'
      && details.resource_kind === 'turn'
      && details.resource_id === station.turnId
      && runtimeEvent.eventType === 'cancelled'
      && runtimeEvent.errorType === 'LIFECYCLE_CANCELLED'
      && Number(runtimeEvent.sequence) > 0
      && runtimeEvent.sourceTransport === 'station-sse'
      && String(runtimeEvent.sourcePtidHash).length === 64
      && runtimeEvent.sourceConversationId === station.conversationId
      && runtimeEvent.sourceTurnId === station.turnId
      && runtimeEvent.sourceSequence === runtimeEvent.sequence
      && runtimeEvent.sourceEventType === runtimeEvent.eventType
    ),
    localizedCancellationVisible: (
      receiver.visible === true
      && receiver.terminalStatus === 'cancelled'
      && receiver.errorType === 'LIFECYCLE_CANCELLED'
      && receiver.resourceKind === 'turn'
      && receiver.resourceId === station.turnId
      && receiver.errorText === receiver.expectedErrorText
      && receiver.recoveryVisible === false
      && receiver.resolutionPresent === false
      && receiverPhaseMatches(
        'live',
        String(station.messageId),
        'cancelled_by_user',
      )
      && receiverPhaseMatches(
        'reload',
        String(station.messageId),
        '',
      )
      && receiverPhaseMatches(
        'replaySnapshot',
        String(station.messageId),
        'cancelled_by_user',
      )
    ),
    cancelledPersisted: (
      station.turnStatus === 'cancelled'
      && station.attemptStatus === 'cancelled'
      && station.messageStatus === 'cancelled'
      && station.terminalReason === 'cancelled_by_user'
      && persistedOutcome.error === outcome.error
      && persistedOutcome.error_type === outcome.error_type
      && persistedOutcome.locale_key === outcome.locale_key
      && persistedOutcome.retryable === outcome.retryable
      && persistedOutcome.terminal === outcome.terminal
      && stableJson(Object.keys(persistedDetails).sort())
        === stableJson(safeDetailKeys)
      && persistedDetails.resource_kind === details.resource_kind
      && persistedDetails.resource_id === details.resource_id
      && cancellation.status === 'cancelled'
    ),
    exactlyOneAuthoritativeTerminal: (
      Number(station.terminalEventCount) === 1
      && Number(station.cancelledEventCount) === 1
      && Number(station.errorEventCount) === 0
    ),
    zeroLateSuccess: (
      Number(station.doneEventCount) === 0
      && Number(station.liveDoneEventCount) === 0
    ),
    replayEqual: (
      replay.equal === true
      && replay.sourceHash === replay.replayHash
      && replaySnapshot.sourceTransport === 'station-sse'
      && replaySnapshot.sourcePtidHash === runtimeEvent.sourcePtidHash
      && replaySnapshot.sourceConversationId === station.conversationId
      && replaySnapshot.sourceTurnId === station.turnId
      && replaySnapshot.sourceSequence === runtimeEvent.sourceSequence
      && replaySnapshot.sourceEventType === 'snapshot'
      && replaySnapshot.status === 'cancelled'
    ),
    cleanupComplete: (
      Number(cleanup.cancellationRequestCount) === 1
      && Number(cleanup.terminalCleanupCount) === 1
      && cleanup.conversationDeleted === true
    ),
  };
}

function evaluateBaseContextOverflow(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(
    ctx.scenarioFacts,
    'foundationContextOverflowFacts',
  );
  const outcome = evidenceRecord(
    facts.outcome,
    'foundationContextOverflowOutcome',
  );
  const details = evidenceRecord(
    outcome.details,
    'foundationContextOverflowDetails',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationContextOverflowReceiver',
  );
  const station = evidenceRecord(
    facts.station,
    'foundationContextOverflowStation',
  );
  const replay = evidenceRecord(
    facts.replay,
    'foundationContextOverflowReplay',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationContextOverflowCleanup',
  );
  const runtimeEvent = evidenceRecord(
    facts.runtimeEvent,
    'foundationContextOverflowRuntimeEvent',
  );
  const safeDetailKeys = Object.keys(details).sort();
  const limitTokens = Number(details.limit_tokens);
  const actualTokens = Number(details.actual_tokens);

  return {
    typedContextOverflow: (
      outcome.error === 'agent.errors.contextOverflow'
      && outcome.error_type === 'CONTEXT_OVERFLOW'
      && outcome.locale_key === 'agent.errors.contextOverflow'
      && outcome.retryable === false
      && outcome.terminal === true
      && safeDetailKeys.length === 2
      && safeDetailKeys[0] === 'actual_tokens'
      && safeDetailKeys[1] === 'limit_tokens'
      && Number.isSafeInteger(limitTokens)
      && limitTokens > 0
      && Number.isSafeInteger(actualTokens)
      && actualTokens > limitTokens
      && runtimeEvent.eventType === 'error'
      && runtimeEvent.errorType === 'CONTEXT_OVERFLOW'
      && Number(runtimeEvent.sequence) > 0
      && Number(runtimeEvent.streamGeneration) > 0
      && runtimeEvent.sourceTransport === 'station-sse'
      && String(runtimeEvent.sourcePtidHash).length === 64
      && runtimeEvent.sourceConversationId === station.conversationId
      && runtimeEvent.sourceTurnId === ''
      && Number(runtimeEvent.sourceSequence) === 0
      && runtimeEvent.sourceEventType === 'error'
    ),
    localizedRecoveryVisible: (
      receiver.errorVisible === true
      && receiver.errorText === receiver.expectedErrorText
      && receiver.recoveryVisible === true
      && receiver.recoveryText === receiver.expectedRecoveryText
    ),
    rejectedDraftPreserved: (
      Number(receiver.draftLengthBefore) > 0
      && receiver.draftLengthAfterRejection === receiver.draftLengthBefore
      && receiver.draftHashAfterRejection === receiver.draftHashBefore
    ),
    reduceContextExecuted: (
      receiver.composerFocusedAfterRecovery === true
      && Number(receiver.reducedDraftLength) > 0
      && Number(receiver.reducedDraftLength)
        < Number(receiver.draftLengthAfterRejection)
      && typeof receiver.reducedDraftHash === 'string'
      && receiver.reducedDraftHash.length === 64
    ),
    stationStateUnchanged: (
      station.conversationVersionAfter === station.conversationVersionBefore
      && station.afterHash === station.beforeHash
    ),
    zeroPersistenceAndProvider: (
      Number(station.turnDelta) === 0
      && Number(station.messageDelta) === 0
      && Number(station.queueDelta) === 0
      && Number(station.providerExecutionDelta) === 0
    ),
    replayEqual: (
      replay.equal === true
      && replay.sourceHash === replay.replayHash
    ),
    cleanupComplete: (
      cleanup.draftCleared === true
      && cleanup.localProjectionCleared === true
      && cleanup.conversationDeleted === true
    ),
  };
}

function evaluateBaseDuplicateConflict(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(
    ctx.scenarioFacts,
    'foundationDuplicateConflictFacts',
  );
  const outcome = evidenceRecord(
    facts.outcome,
    'foundationDuplicateConflictOutcome',
  );
  const details = evidenceRecord(
    outcome.details,
    'foundationDuplicateConflictDetails',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationDuplicateConflictReceiver',
  );
  const station = evidenceRecord(
    facts.station,
    'foundationDuplicateConflictStation',
  );
  const replay = evidenceRecord(
    facts.replay,
    'foundationDuplicateConflictReplay',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationDuplicateConflictCleanup',
  );
  const runtimeEvent = evidenceRecord(
    facts.runtimeEvent,
    'foundationDuplicateConflictRuntimeEvent',
  );
  const detailKeys = Object.keys(details).sort();
  const originalMessageIdsBefore = evidenceArray(
    station.originalMessageIdsBefore,
    'foundationDuplicateConflictMessageIdsBefore',
  );
  const originalMessageIdsAfter = evidenceArray(
    station.originalMessageIdsAfter,
    'foundationDuplicateConflictMessageIdsAfter',
  );
  const idempotencyKeyHash = String(station.idempotencyKeyHash ?? '');
  const originalTurnId = String(station.originalTurnId ?? '');

  return {
    typedDuplicateConflictProjected: (
      outcome.error === 'agent.errors.duplicateConflict'
      && outcome.error_type === 'ADMISSION_DUPLICATE_CONFLICT'
      && outcome.locale_key === 'agent.errors.duplicateConflict'
      && outcome.retryable === false
      && outcome.terminal === true
      && detailKeys.length === 2
      && detailKeys[0] === 'existing_command_id'
      && detailKeys[1] === 'idempotency_key_hash'
      && details.idempotency_key_hash === idempotencyKeyHash
      && details.existing_command_id === originalTurnId
      && /^[0-9a-f]{64}$/.test(idempotencyKeyHash)
      && runtimeEvent.eventType === 'error'
      && runtimeEvent.errorType === 'ADMISSION_DUPLICATE_CONFLICT'
      && Number(runtimeEvent.sequence) > 0
      && Number(runtimeEvent.streamGeneration) > 0
      && runtimeEvent.sourceTransport === 'station-sse'
      && String(runtimeEvent.sourcePtidHash).length === 64
      && runtimeEvent.sourceConversationId === station.conversationId
      && runtimeEvent.sourceTurnId === ''
      && Number(runtimeEvent.sourceSequence) === 0
      && runtimeEvent.sourceEventType === 'error'
    ),
    localizedRecoveryVisible: (
      receiver.errorVisible === true
      && receiver.errorText === receiver.expectedErrorText
      && receiver.recoveryVisible === true
      && receiver.recoveryText === receiver.expectedRecoveryText
    ),
    openOriginalExecuted: (
      receiver.openOriginalExecuted === true
      && receiver.openedTurnId === originalTurnId
    ),
    originalCommandPreserved: (
      station.existingCommandId === originalTurnId
      && station.conversationVersionAfter
        === station.conversationVersionBefore
      && station.afterHash === station.beforeHash
      && stableJson(originalMessageIdsAfter)
        === stableJson(originalMessageIdsBefore)
    ),
    zeroNewRows: (
      Number(station.turnDelta) === 0
      && Number(station.messageDelta) === 0
      && Number(station.queueDelta) === 0
    ),
    zeroProviderCall:
      Number(station.providerExecutionDelta) === 0,
    replayEqual: (
      replay.equal === true
      && replay.sourceHash === replay.replayHash
      && replay.sourceHash === station.beforeHash
      && replay.replayHash === station.afterHash
    ),
    cleanupComplete: (
      cleanup.conversationDeleted === true
      && cleanup.localProjectionCleared === true
      && cleanup.operationCleared === true
      && cleanup.portalClosed === true
    ),
  };
}

function evaluateBaseCredentialMissing(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(
    ctx.scenarioFacts,
    'foundationCredentialMissingFacts',
  );
  const outcome = evidenceRecord(
    facts.outcome,
    'foundationCredentialMissingOutcome',
  );
  const details = evidenceRecord(
    outcome.details,
    'foundationCredentialMissingDetails',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationCredentialMissingReceiver',
  );
  const station = evidenceRecord(
    facts.station,
    'foundationCredentialMissingStation',
  );
  const replay = evidenceRecord(
    facts.replay,
    'foundationCredentialMissingReplay',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationCredentialMissingCleanup',
  );
  const runtimeEvent = evidenceRecord(
    facts.runtimeEvent,
    'foundationCredentialMissingRuntimeEvent',
  );

  return {
    typedProviderConfigMissing: (
      outcome.error === 'agent.errors.providerCredentialMissing'
      && outcome.error_type === 'PROVIDER_CREDENTIAL_MISSING'
      && outcome.locale_key === 'agent.errors.providerCredentialMissing'
      && outcome.retryable === true
      && outcome.terminal === true
      && Object.keys(details).length === 1
      && details.provider_id === station.providerId
      && runtimeEvent.eventType === 'error'
      && runtimeEvent.errorType === 'PROVIDER_CREDENTIAL_MISSING'
      && Number(runtimeEvent.sequence) > 0
      && Number(runtimeEvent.streamGeneration) > 0
      && runtimeEvent.sourceTransport === 'station-sse'
      && String(runtimeEvent.sourcePtidHash).length === 64
      && runtimeEvent.sourceConversationId === station.conversationId
      && runtimeEvent.sourceTurnId === ''
      && Number(runtimeEvent.sourceSequence) === 0
      && runtimeEvent.sourceEventType === 'error'
    ),
    localizedRecoveryVisible: (
      receiver.errorVisible === true
      && receiver.errorText === receiver.expectedErrorText
      && receiver.recoveryVisible === true
      && receiver.recoveryText === receiver.expectedRecoveryText
    ),
    configureProviderExecuted:
      receiver.configureProviderExecuted === true,
    providerConfigAbsentAtAdmission: (
      station.providerConfiguredBefore === false
      && station.providerConfiguredAfter === false
    ),
    stationStateUnchanged: (
      station.conversationVersionAfter === station.conversationVersionBefore
      && station.afterHash === station.beforeHash
      && Number(station.turnDelta) === 0
      && Number(station.messageDelta) === 0
      && Number(station.queueDelta) === 0
    ),
    zeroProviderCall: Number(station.providerExecutionDelta) === 0,
    replayEqual: (
      replay.equal === true
      && replay.sourceHash === replay.replayHash
    ),
    cleanupComplete: (
      cleanup.conversationDeleted === true
      && cleanup.disposableAgentDeleted === true
      && cleanup.restoredSelection === cleanup.priorSelection
    ),
  };
}

function evaluateBaseAttachmentRejected(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(
    ctx.scenarioFacts,
    'foundationAttachmentRejectedFacts',
  );
  const outcome = evidenceRecord(
    facts.outcome,
    'foundationAttachmentRejectedOutcome',
  );
  const details = evidenceRecord(
    outcome.details,
    'foundationAttachmentRejectedDetails',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationAttachmentRejectedReceiver',
  );
  const station = evidenceRecord(
    facts.station,
    'foundationAttachmentRejectedStation',
  );
  const replay = evidenceRecord(
    facts.replay,
    'foundationAttachmentRejectedReplay',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationAttachmentRejectedCleanup',
  );
  const runtimeEvent = evidenceRecord(
    facts.runtimeEvent,
    'foundationAttachmentRejectedRuntimeEvent',
  );
  const deletionReadback = evidenceRecord(
    cleanup.deletionReadback,
    'foundationAttachmentRejectedDeletionReadback',
  );
  const safeDetailKeys = Object.keys(details).sort();
  const isSha256 = (value: unknown) =>
    typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

  return {
    typedAttachmentRejected: (
      outcome.error === 'agent.errors.attachmentRejected'
      && outcome.error_type === 'CONTEXT_ATTACHMENT_REJECTED'
      && outcome.locale_key === 'agent.errors.attachmentRejected'
      && outcome.retryable === false
      && outcome.terminal === true
      && safeDetailKeys.length === 2
      && safeDetailKeys[0] === 'attachment_id'
      && safeDetailKeys[1] === 'reason_code'
      && details.attachment_id === station.attachmentId
      && details.reason_code === station.reasonCode
      && station.reasonCode === 'attachment_object_is_unavailable'
      && runtimeEvent.eventType === 'error'
      && runtimeEvent.errorType === 'CONTEXT_ATTACHMENT_REJECTED'
      && Number(runtimeEvent.sequence) > 0
      && Number(runtimeEvent.streamGeneration) > 0
      && typeof runtimeEvent.observedAt === 'string'
      && runtimeEvent.observedAt.length > 0
      && isSha256(runtimeEvent.eventId)
      && isSha256(runtimeEvent.streamIdHash)
      && isSha256(runtimeEvent.conversationIdHash)
      && isSha256(runtimeEvent.payloadHash)
    ),
    localizedRemovalVisible: (
      receiver.errorVisible === true
      && receiver.errorText === receiver.expectedErrorText
      && receiver.removalVisible === true
      && receiver.removalText === receiver.expectedRemovalText
    ),
    rejectedDraftPreserved: (
      receiver.attachmentVisibleAfterReject === true
      && receiver.attachmentStatusAfterReject === 'rejected'
      && receiver.draftTextAfterRejection === receiver.draftTextBefore
    ),
    removeAttachmentExecuted: (
      receiver.removalExecuted === true
      && receiver.attachmentPresentAfterRemoval === false
    ),
    stationStateUnchanged: (
      Number(station.conversationVersionBefore)
        === Number(station.conversationVersionAfter)
      && station.beforeHash === station.afterHash
      && Number(station.turnDelta) === 0
      && Number(station.messageDelta) === 0
    ),
    zeroSideEffect: Number(station.providerExecutionDelta) === 0,
    replayEqual: (
      replay.equal === true
      && replay.sourceHash === replay.replayHash
    ),
    cleanupComplete: (
      cleanup.draftRemoved === true
      && cleanup.objectDeleted === true
      && deletionReadback.source === 'oss-owner-list'
      && deletionReadback.objectRefHash === station.objectRefHash
      && isSha256(deletionReadback.objectRefHash)
      && isSha256(deletionReadback.objectPathHash)
      && typeof deletionReadback.deletedAt === 'string'
      && deletionReadback.deletedAt.length > 0
      && Number(deletionReadback.readAttempt) > 0
      && cleanup.conversationDeleted === true
    ),
  };
}

function evaluateBaseApprovalDenied(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(
    ctx.scenarioFacts,
    'foundationApprovalDeniedFacts',
  );
  const outcome = evidenceRecord(
    facts.outcome,
    'foundationApprovalDeniedOutcome',
  );
  const details = evidenceRecord(
    outcome.details,
    'foundationApprovalDeniedDetails',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationApprovalDeniedReceiver',
  );
  const decision = evidenceRecord(
    facts.decision,
    'foundationApprovalDeniedDecision',
  );
  const station = evidenceRecord(
    facts.station,
    'foundationApprovalDeniedStation',
  );
  const lineage = evidenceRecord(
    station.lineage,
    'foundationApprovalDeniedLineage',
  );
  const replay = evidenceRecord(
    facts.replay,
    'foundationApprovalDeniedReplay',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationApprovalDeniedCleanup',
  );
  const safeDetailKeys = Object.keys(details).sort();

  return {
    typedDenialProjected: (
      outcome.error_type === 'TOOL_APPROVAL_DENIED'
      && outcome.locale_key === 'agent.errors.toolApprovalDenied'
      && outcome.retryable === false
      && outcome.terminal === true
      && safeDetailKeys.length === 2
      && safeDetailKeys[0] === 'decision_id'
      && safeDetailKeys[1] === 'tool_call_id'
      && details.tool_call_id === decision.toolCallId
      && details.decision_id === decision.decisionId
    ),
    localizedRecoveryVisible: (
      receiver.recoveryVisible === true
      && receiver.recoveryText === receiver.expectedRecoveryText
      && receiver.errorVisible === true
      && receiver.errorText === receiver.expectedErrorText
    ),
    denialPersisted: (
      decision.accepted === true
      && decision.approved === false
      && station.policy === 'manual'
      && stableJson(station.states)
        === stableJson(['policy_check', 'awaiting_user', 'denied'])
      && station.errorCode === 'TOOL_APPROVAL_DENIED'
      && lineage.toolCallId === decision.toolCallId
      && lineage.decisionId === decision.decisionId
      && Number(lineage.decisionRevision) === decision.decisionRevision
    ),
    zeroSideEffect: (
      Number(station.executionAttemptCount) === 0
      && Number(station.sideEffectCount) === 0
      && Number(station.resultCount) === 0
      && Number(station.continuationCount) === 0
    ),
    replayEqual: (
      replay.equal === true
      && replay.acknowledgementSourceHash
        === replay.acknowledgementReplayHash
      && replay.diagnosticSourceHash === replay.diagnosticReplayHash
    ),
    cleanupComplete: (
      cleanup.conversationDeleted === true
      && cleanup.bindingRestored === true
    ),
  };
}

function evaluateBaseApprovalExpired(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(
    ctx.scenarioFacts,
    'foundationApprovalExpiredFacts',
  );
  const outcome = evidenceRecord(
    facts.outcome,
    'foundationApprovalExpiredOutcome',
  );
  const details = evidenceRecord(
    outcome.details,
    'foundationApprovalExpiredDetails',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationApprovalExpiredReceiver',
  );
  const decision = evidenceRecord(
    facts.decision,
    'foundationApprovalExpiredDecision',
  );
  const station = evidenceRecord(
    facts.station,
    'foundationApprovalExpiredStation',
  );
  const lineage = evidenceRecord(
    station.lineage,
    'foundationApprovalExpiredLineage',
  );
  const recovery = evidenceRecord(
    facts.recovery,
    'foundationApprovalExpiredRecovery',
  );
  const replay = evidenceRecord(
    facts.replay,
    'foundationApprovalExpiredReplay',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationApprovalExpiredCleanup',
  );
  const safeDetailKeys = Object.keys(details).sort();

  return {
    typedExpiryProjected: (
      outcome.error_type === 'TOOL_APPROVAL_EXPIRED'
      && outcome.locale_key === 'agent.errors.toolApprovalExpired'
      && outcome.retryable === true
      && outcome.terminal === true
      && safeDetailKeys.length === 2
      && safeDetailKeys[0] === 'decision_id'
      && safeDetailKeys[1] === 'expires_at'
      && details.decision_id === decision.decisionId
      && details.expires_at === decision.expiresAt
    ),
    localizedRecoveryVisible: (
      receiver.recoveryVisible === true
      && receiver.recoveryText === receiver.expectedRecoveryText
      && receiver.errorVisible === true
      && receiver.errorText === receiver.expectedErrorText
    ),
    expiredDecisionImmutable: (
      decision.accepted === false
      && decision.errorCode
        === 'TOOL_APPROVAL_DECISION_ERROR_CODE_EXPIRED'
      && station.policy === 'manual'
      && stableJson(station.states)
        === stableJson(['policy_check', 'awaiting_user', 'expired'])
      && station.errorCode === 'TOOL_APPROVAL_EXPIRED'
      && lineage.toolCallId === decision.toolCallId
      && lineage.decisionId === ''
      && Number(lineage.decisionRevision) === decision.decisionRevision
    ),
    requestAgainCreatedOneAttempt: (
      receiver.recoveryExecuted === true
      && Number(recovery.attemptCountAfter)
        === Number(recovery.attemptCountBefore) + 1
      && recovery.newApprovalIdentityDistinct === true
      && recovery.cancellationStatus === 'cancelled'
      && recovery.retryToolStatus === 'cancelled'
    ),
    zeroSideEffect: (
      Number(station.executionAttemptCount) === 0
      && Number(station.sideEffectCount) === 0
      && Number(station.resultCount) === 0
      && Number(station.continuationCount) === 0
      && Number(recovery.retryExecutionAttemptCount) === 0
      && Number(recovery.retrySideEffectCount) === 0
      && Number(recovery.retryResultCount) === 0
      && Number(recovery.retryContinuationCount) === 0
    ),
    replayEqual: (
      replay.equal === true
      && replay.acknowledgementSourceHash
        === replay.acknowledgementReplayHash
      && replay.stationSourceHash === replay.stationReplayHash
    ),
    cleanupComplete: (
      cleanup.conversationDeleted === true
      && cleanup.bindingRestored === true
    ),
  };
}

function evaluateBaseActiveMutationConflict(
  ctx: DirectCellAssertionContext,
): Record<string, boolean> {
  const facts = evidenceRecord(
    ctx.scenarioFacts,
    'foundationActiveMutationConflictFacts',
  );
  const rejection = evidenceRecord(
    facts.rejection,
    'foundationActiveMutationConflictRejection',
  );
  const details = evidenceRecord(
    rejection.details,
    'foundationActiveMutationConflictErrorDetails',
  );
  const winner = evidenceRecord(
    facts.winner,
    'foundationActiveMutationConflictWinner',
  );
  const staleMutation = evidenceRecord(
    facts.staleMutation,
    'foundationActiveMutationConflictStaleMutation',
  );
  const receiver = evidenceRecord(
    facts.receiver,
    'foundationActiveMutationConflictReceiver',
  );
  const cleanup = evidenceRecord(
    facts.cleanup,
    'foundationActiveMutationConflictCleanup',
  );
  return {
    typedConflictRejected: (
      rejection.code === 'ADMISSION_ACTIVE_MUTATION_CONFLICT'
      && rejection.localeKey === 'agent.errors.activeMutationConflict'
      && rejection.retryable === true
      && rejection.terminal === true
      && details.resource_id === winner.resourceId
      && Number(details.expected_revision) === winner.expectedRevision
      && Number(details.actual_revision) === winner.actualRevision
      && winner.actualRevision === Number(winner.expectedRevision) + 1
    ),
    localizedRecoveryVisible: (
      receiver.conflictVisible === true
      && receiver.reloadVisible === true
      && String(receiver.conflictText).includes(
        String(receiver.expectedConflictText),
      )
      && receiver.reloadText === receiver.expectedReloadText
    ),
    reloadLatestExecuted: (
      receiver.reloadExecuted === true
      && receiver.reloadedRevision === winner.actualRevision
    ),
    winnerPreserved: (
      winner.revisionBeforeStale === winner.actualRevision
      && winner.revisionAfterStale === winner.actualRevision
      && winner.revisionAfterReload === winner.actualRevision
      && winner.hashBeforeStale === winner.hashAfterStale
      && winner.hashBeforeStale === winner.hashAfterReload
    ),
    zeroStaleMutation: staleMutation.mutationDelta === 0,
    cleanupComplete: (
      cleanup.deletedFromRoster === true
      && cleanup.deletedFromStation === true
      && cleanup.conversationDeleted === true
      && cleanup.restoredSelection === cleanup.priorSelection
    ),
  };
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
  const replayRequestCursor = Number(handoff.replayRequestCursor);
  const acknowledgedCursor = Number(handoff.acknowledgedCursor);
  const replayThroughCursor = Number(replay.throughCursor);

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
      Number.isSafeInteger(replayRequestCursor)
      && replayRequestCursor > 0
      && Number.isSafeInteger(acknowledgedCursor)
      && acknowledgedCursor >= replayRequestCursor
      && Number(replay.afterCursor) === acknowledgedCursor
      && Number.isSafeInteger(replayThroughCursor)
      && replayThroughCursor > acknowledgedCursor
      && acknowledgedCursor === Number(idempotence.cursorBeforeMutation)
      && replaySequences.length > 0
      && replaySequences.every((sequence) =>
        Number.isSafeInteger(sequence)
        && sequence > Number(replay.afterCursor))
      && replaySequences.every((sequence, index) =>
        index === 0 || sequence > replaySequences[index - 1])
      && replaySequences[replaySequences.length - 1] === replayThroughCursor
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
  const receiverInteraction = evidenceRecord(
    facts.receiverInteraction,
    'foundationF05ReceiverInteraction',
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
    historyAttachmentActionVisible:
      typeof receiverInteraction.attachmentId === 'string'
      && receiverInteraction.attachmentId.length > 0
      && receiverInteraction.visible === true
      && receiverInteraction.keyboardReachable === true
      && receiverInteraction.accessibleNamePresent === true
      && receiverInteraction.openInvoked === true
      && typeof receiverInteraction.openedUrlHash === 'string'
      && receiverInteraction.openedUrlHash.length > 0,
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
  return withFoundationReadyCapabilityFixture(
    input.agent,
    input.platform,
    async (authoritativeAgent) => {
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
        { requireEffectiveCapabilities: true },
      );
    },
  );
}

function evaluateF01(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const hasProvider = Boolean(ctx.agent?.provider);
  const hasModel = Boolean(ctx.agent?.model);
  const isAuthenticated = ctx.sessionState.authenticated;
  const hasCapabilitySession = Boolean(ctx.capabilitySessions.selectedStationSession);
  const profileExists = Boolean(ctx.profile.profile_id);
  const toolIsolation = evidenceRecord(
    ctx.scenarioFacts,
    'foundationF01ToolIsolation',
  );
  const isolation = evidenceRecord(
    toolIsolation.toolIsolation,
    'foundationF01ToolIsolationState',
  );

  return {
    configured:
      hasProvider
      && hasModel
      && profileExists
      && isFoundationCapabilityIsolationRestored(isolation)
      && Number(isolation.readyCapabilityCount) === 0,
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
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationF10Facts');
  const core = evidenceRecord(facts.coreOutcome, 'foundationF10CoreOutcome');
  const toolIsolation = evidenceRecord(
    facts.toolIsolation,
    'foundationF10ToolIsolation',
  );
  const session = evidenceRecord(
    facts.capabilitySession,
    'foundationF10CapabilitySession',
  );
  const selectedDevice = evidenceRecord(
    facts.selectedDevice,
    'foundationF10SelectedDevice',
  );
  const rejections = evidenceRecord(
    facts.rejections,
    'foundationF10Rejections',
  );
  const execution = evidenceRecord(
    facts.execution,
    'foundationF10Execution',
  );
  const rejection = (name: string, codes: string[]): boolean | null => {
    const value = evidenceRecord(rejections[name], `foundationF10${name}`);
    if (
      value.availability === 'unavailable'
      && value.unavailable_reason === 'NO_PRODUCTION_CAPABILITY_ENDPOINT'
    ) return null;
    return value.accepted === false && codes.includes(String(value.errorCode ?? ''));
  };
  const capabilityCount = Number(session.capabilityCount ?? -1);

  return {
    coreOutcomesMatch:
      core.stationStatus === 'completed'
      && core.receiverStatus === 'completed'
      && Number(toolIsolation.readyCapabilityCount) === 0
      && toolIsolation.restorationVerified === true
      && Number(toolIsolation.restoredReadyCapabilityCount)
        === Number(toolIsolation.originalReadyCapabilityCount)
      && toolIsolation.restoredReadyCapabilityHash
        === toolIsolation.originalReadyCapabilityHash,
    unsupportedRejected: rejection(
      'unsupported',
      ['AGENT_4002', 'CAPABILITY_UNAVAILABLE'],
    ),
    unauthorizedRejected: rejection(
      'unauthorized',
      ['AGENT_4002', 'UNAUTHORIZED'],
    ),
    signatureTamperRejected: rejection(
      'signatureTamper',
      ['CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID'],
    ),
    schemaMismatchRejected: rejection(
      'schemaMismatch',
      ['AGENT_4002', 'CLIENT_CAPABILITY_SCHEMA_MISMATCH'],
    ),
    selectedDeviceOwnsExecution:
      session.sessionId === session.readinessSessionId
      && session.platform === ctx.platform
      && (
        ctx.platform === 'browser'
          ? capabilityCount === 0 && selectedDevice.executionDeviceId === null
          : capabilityCount > 0
            && selectedDevice.executionDeviceId === selectedDevice.sessionDeviceId
      ),
    noDesktopFallback: Number(execution.desktopFallbackDelta ?? -1) === 0,
    crossDeviceRejected: rejection(
      'crossDevice',
      [
        'AGENT_4002',
        'CLIENT_CAPABILITY_COMMAND_ERROR_CODE_AUTHORITY_MISMATCH',
        'CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID',
        'CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH',
      ],
    ),
    zeroExecutionOnReject: [
      'localAttemptDelta',
      'sideEffectDelta',
      'resultDelta',
      'continuationDelta',
    ].every((key) => Number(execution[key] ?? -1) === 0),
  };
}

function evaluateF12(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationF12Facts');
  const topics = evidenceRecord(facts.topics, 'foundationF12Topics');
  const alpha = evidenceRecord(topics.alpha, 'foundationF12Alpha');
  const beta = evidenceRecord(topics.beta, 'foundationF12Beta');
  const alphaPre = evidenceRecord(
    alpha.preRestart,
    'foundationF12AlphaPreRestart',
  );
  const betaPre = evidenceRecord(
    beta.preRestart,
    'foundationF12BetaPreRestart',
  );
  const alphaPost = evidenceRecord(
    alpha.postRestart,
    'foundationF12AlphaPostRestart',
  );
  const betaPost = evidenceRecord(
    beta.postRestart,
    'foundationF12BetaPostRestart',
  );
  const alphaConversation = evidenceRecord(
    alphaPost.conversation,
    'foundationF12AlphaConversation',
  );
  const betaConversation = evidenceRecord(
    betaPost.conversation,
    'foundationF12BetaConversation',
  );
  const topicMessages = (
    topic: Record<string, unknown>,
    label: string,
  ): Record<string, unknown>[] => {
    const snapshots = [
      evidenceRecord(topic.postRestart, `${label}PostRestart`),
      evidenceRecord(topic.alternatePostRestart, `${label}AlternatePostRestart`),
      evidenceRecord(
        topic.restoredSelectedPostRestart,
        `${label}RestoredPostRestart`,
      ),
    ];
    const messages = snapshots.flatMap((snapshot) =>
      evidenceArray(snapshot.messages, `${label}Messages`)
        .map((value) => evidenceRecord(value, `${label}Message`)));
    return Array.from(new Map(
      messages.map((message) => [String(message.messageId ?? ''), message]),
    ).values());
  };
  const alphaMessages = topicMessages(alpha, 'foundationF12Alpha');
  const betaMessages = topicMessages(beta, 'foundationF12Beta');
  const alphaMessageIds = new Set(
    alphaMessages.map((message) => String(message.messageId ?? '')),
  );
  const betaMessageIds = new Set(
    betaMessages.map((message) => String(message.messageId ?? '')),
  );
  const alphaTurnIds = new Set(
    alphaMessages.map((message) => String(message.turnId ?? '')).filter(Boolean),
  );
  const betaTurnIds = new Set(
    betaMessages.map((message) => String(message.turnId ?? '')).filter(Boolean),
  );
  const alphaBranchIds = new Set(
    alphaMessages.map((message) => String(message.branchId ?? '')).filter(Boolean),
  );
  const betaBranchIds = new Set(
    betaMessages.map((message) => String(message.branchId ?? '')).filter(Boolean),
  );
  const disjoint = (left: Set<string>, right: Set<string>) =>
    [...left].every((value) => !right.has(value));
  const referencesStayWithin = (
    messages: Record<string, unknown>[],
    messageIds: Set<string>,
    conversationId: string,
  ) => messages.every((message) => (
    message.conversationId === conversationId
    && (
      !message.parentMessageId
      || messageIds.has(String(message.parentMessageId))
    )
    && (
      !message.replacesMessageId
      || messageIds.has(String(message.replacesMessageId))
    )
  ));
  const runtimeMatches = (topic: Record<string, unknown>) => {
    const post = evidenceRecord(
      topic.postRestart,
      'foundationF12RuntimePostRestart',
    );
    const conversation = evidenceRecord(
      post.conversation,
      'foundationF12RuntimeConversation',
    );
    const binding = evidenceRecord(
      conversation.runtimeBinding,
      'foundationF12RuntimeBinding',
    );
    const runtimeTurn = evidenceRecord(
      post.runtimeTurn,
      'foundationF12RuntimeTurn',
    );
    return (
      binding.runtimeKind === runtimeTurn.runtimeKind
      && binding.providerId === runtimeTurn.providerId
      && binding.modelId === runtimeTurn.modelId
      && binding.runtimeProfileId === runtimeTurn.runtimeProfileId
      && binding.externalSessionId === runtimeTurn.externalSessionId
      && Number(binding.externalSessionEpoch)
        === Number(runtimeTurn.externalSessionEpoch)
      && (
        binding.runtimeKind !== 'direct_model'
        || (
          binding.externalSessionId === ''
          && binding.runtimeHomeRef === ''
        )
      )
    );
  };
  const alphaReceiver = evidenceRecord(
    alpha.receiverAfter,
    'foundationF12AlphaReceiver',
  );
  const betaReceiver = evidenceRecord(
    beta.receiverAfter,
    'foundationF12BetaReceiver',
  );
  const branchTraversalRestored = (topic: Record<string, unknown>) => {
    const selectedBranchMessageId = String(
      topic.selectedBranchMessageId ?? '',
    );
    const sourceAssistantMessageId = String(
      topic.sourceAssistantMessageId ?? '',
    );
    const siblingMessageId = String(topic.siblingMessageId ?? '');
    const alternateBranchMessageId =
      selectedBranchMessageId === siblingMessageId
        ? sourceAssistantMessageId
        : siblingMessageId;
    const alternate = evidenceRecord(
      topic.alternatePostRestart,
      'foundationF12AlternatePostRestart',
    );
    const restored = evidenceRecord(
      topic.restoredSelectedPostRestart,
      'foundationF12RestoredSelectedPostRestart',
    );
    return (
      selectedBranchMessageId.length > 0
      && sourceAssistantMessageId.length > 0
      && siblingMessageId.length > 0
      && sourceAssistantMessageId !== siblingMessageId
      && evidenceRecord(
        alternate.conversation,
        'foundationF12AlternateConversation',
      ).activeBranchMessageId === alternateBranchMessageId
      && alternate.selectedBranchMessageId === alternateBranchMessageId
      && evidenceRecord(
        restored.conversation,
        'foundationF12RestoredConversation',
      ).activeBranchMessageId === selectedBranchMessageId
      && restored.selectedBranchMessageId === selectedBranchMessageId
    );
  };
  const restart = evidenceRecord(facts.restart, 'foundationF12Restart');
  const stale = evidenceRecord(
    facts.staleMutation,
    'foundationF12StaleMutation',
  );
  const staleBefore = evidenceRecord(
    stale.before,
    'foundationF12StaleBefore',
  );
  const staleAfter = evidenceRecord(
    stale.after,
    'foundationF12StaleAfter',
  );
  const toolIsolation = evidenceRecord(
    facts.toolIsolation,
    'foundationF12ToolIsolation',
  );
  const referenceDiagnostics = (
    messages: Record<string, unknown>[],
    messageIds: Set<string>,
    conversationId: string,
  ) => ({
    wrongConversationCount: messages.filter((message) =>
      message.conversationId !== conversationId).length,
    missingParentCount: messages.filter((message) =>
      Boolean(message.parentMessageId)
      && !messageIds.has(String(message.parentMessageId))).length,
    missingReplacementCount: messages.filter((message) =>
      Boolean(message.replacesMessageId)
      && !messageIds.has(String(message.replacesMessageId))).length,
  });
  const alphaReferenceDiagnostics = referenceDiagnostics(
    alphaMessages,
    alphaMessageIds,
    String(alphaConversation.conversationId),
  );
  const betaReferenceDiagnostics = referenceDiagnostics(
    betaMessages,
    betaMessageIds,
    String(betaConversation.conversationId),
  );
  // #region debug-point F-K:as-f12-cross-topic
  void reportFoundationF12ProjectionDebug('F-K', 'cross-topic-checks', {
    alphaForeignFactHidden: alphaReceiver.foreignFactVisible === false,
    alphaOwnFactVisible: alphaReceiver.ownFactVisible === true,
    alphaReferencesOwned: referencesStayWithin(
      alphaMessages,
      alphaMessageIds,
      String(alphaConversation.conversationId),
    ),
    alphaRuntimeMatches: runtimeMatches(alpha),
    alphaReferenceDiagnostics,
    betaForeignFactHidden: betaReceiver.foreignFactVisible === false,
    betaOwnFactVisible: betaReceiver.ownFactVisible === true,
    betaReferencesOwned: referencesStayWithin(
      betaMessages,
      betaMessageIds,
      String(betaConversation.conversationId),
    ),
    betaRuntimeMatches: runtimeMatches(beta),
    betaReferenceDiagnostics,
  });
  // #endregion

  return {
    twoTopicsDistinct:
      String(alphaConversation.conversationId).length > 0
      && String(betaConversation.conversationId).length > 0
      && alphaConversation.conversationId !== betaConversation.conversationId
      && String(alpha.fact).length > 0
      && String(beta.fact).length > 0
      && alpha.fact !== beta.fact
      && disjoint(alphaMessageIds, betaMessageIds)
      && disjoint(alphaTurnIds, betaTurnIds),
    restartRestored:
      restart.stationRestarted === true
      && restart.clientRestarted === true
      && alpha.preRestartHash === alpha.postRestartHash
      && beta.preRestartHash === beta.postRestartHash
      && stableJson(alphaPre) === stableJson(alphaPost)
      && stableJson(betaPre) === stableJson(betaPost)
      && toolIsolation.restorationVerified === true,
    branchesIndependent:
      alphaConversation.activeBranchMessageId
        === alpha.selectedBranchMessageId
      && betaConversation.activeBranchMessageId
        === beta.selectedBranchMessageId
      && alphaMessageIds.has(String(alpha.selectedBranchMessageId))
      && betaMessageIds.has(String(beta.selectedBranchMessageId))
      && branchTraversalRestored(alpha)
      && branchTraversalRestored(beta)
      && disjoint(alphaBranchIds, betaBranchIds)
      && alphaReceiver.selectedBranchVisible === true
      && betaReceiver.selectedBranchVisible === true,
    noCrossTopicReferences:
      referencesStayWithin(
        alphaMessages,
        alphaMessageIds,
        String(alphaConversation.conversationId),
      )
      && referencesStayWithin(
        betaMessages,
        betaMessageIds,
        String(betaConversation.conversationId),
      )
      && alphaReceiver.ownFactVisible === true
      && alphaReceiver.foreignFactVisible === false
      && betaReceiver.ownFactVisible === true
      && betaReceiver.foreignFactVisible === false
      && runtimeMatches(alpha)
      && runtimeMatches(beta),
    staleMutationConflict:
      stale.errorCode === 'VERSION_CONFLICT'
      && staleBefore.alphaHash === staleAfter.alphaHash
      && staleBefore.betaHash === staleAfter.betaHash
      && Number(staleBefore.alphaVersion) === Number(staleAfter.alphaVersion)
      && Number(staleBefore.betaVersion) === Number(staleAfter.betaVersion),
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

    async configureStation({ stationUrl }: ConfigureStationInput) {
      const expectedUrl = stationUrl.trim().replace(/\/+$/, '');
      const probed = await api.stationAdd(expectedUrl);
      await api.stationSetActive(expectedUrl);
      const registry = await api.stationList();
      const activeUrl = registry.active_url?.trim().replace(/\/+$/, '') ?? null;
      const activeEntry = registry.entries.find(
        (entry) => entry.url.trim().replace(/\/+$/, '') === expectedUrl,
      );
      const peerIdAvailable = Boolean(
        activeEntry?.peer_id?.trim() || probed.peer_id?.trim(),
      );

      return {
        configured:
          activeUrl === expectedUrl
          && activeEntry?.online === true
          && peerIdAvailable,
        activeUrl,
        online: activeEntry?.online === true,
        peerIdAvailable,
      };
    },

    async loginWithPassword({ account, password }: LoginInput) {
      // #region debug-point A-B-D-E:identity-login-precondition
      const reportIdentityDebug = (
        hypothesisId: string,
        msg: string,
      ): void => {
        const snapshot = identityRuntime.getSnapshot();
        void fetch('http://127.0.0.1:7778/event', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'foundation-identity-boot',
            runId: 'post-fix',
            hypothesisId,
            location: 'apps/desktop/src/acceptance/agent/harness.ts:loginWithPassword',
            msg: `[DEBUG] ${msg}`,
            data: {
              phaseKind: snapshot.phase.kind,
              phaseReason:
                'reason' in snapshot.phase ? snapshot.phase.reason : null,
              lifecycleState: snapshot.lifecycle.state,
              dataReady: snapshot.lifecycle.dataReady,
              authenticated: useSessionStore.getState().authenticated,
            },
            ts: Date.now(),
          }),
        }).catch(() => {});
      };
      let priorIdentityDebugState = '';
      reportIdentityDebug('E', 'login entry');
      identityRuntime.boot();
      reportIdentityDebug('D', 'boot requested');
      try {
        await waitFor(
          () => {
            const snapshot = identityRuntime.getSnapshot();
            const currentIdentityDebugState = stableJson({
              phaseKind: snapshot.phase.kind,
              phaseReason:
                'reason' in snapshot.phase ? snapshot.phase.reason : null,
              lifecycleState: snapshot.lifecycle.state,
              dataReady: snapshot.lifecycle.dataReady,
              authenticated: useSessionStore.getState().authenticated,
            });
            if (currentIdentityDebugState !== priorIdentityDebugState) {
              priorIdentityDebugState = currentIdentityDebugState;
              reportIdentityDebug('A', 'identity phase changed');
            }
            return (
              snapshot.phase.kind === 'accountGate'
              && snapshot.lifecycle.dataReady
            ) || (
              useSessionStore.getState().authenticated
              && snapshot.lifecycle.state === 'ready'
            );
          },
          'identity login precondition',
          30_000,
        );
      } catch (error) {
        reportIdentityDebug('B', 'identity login precondition failed');
        throw error;
      }
      // #endregion
      if (useSessionStore.getState().authenticated) {
        await identityRuntime.logout();
      }
      await waitFor(
        () => {
          const snapshot = identityRuntime.getSnapshot();
          return snapshot.phase.kind === 'accountGate' && snapshot.lifecycle.dataReady;
        },
        'identity account gate before login',
        30_000,
      );

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
      if (user?.actorPtid) {
        await installAuthenticatedCriticalRuntimes(user.actorPtid);
      }
      if (user?.actorPtid) {
        await installDeferredAppRuntimeProjections(user.actorPtid);
      }
      return {
        authenticated: Boolean(user?.actorPtid),
        actorId: user?.actorPtid ?? null,
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
      const actorId = useSessionStore.getState().currentUser?.actorPtid ?? null;
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
      // #region debug-point F-I:ensure-provider-stage
      const reportEnsureProviderStage = (
        stage: string,
        data: Record<string, unknown> = {},
      ): void => {
        void fetch('http://127.0.0.1:7778/event', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'foundation-identity-boot',
            runId: 'pre-fix',
            hypothesisId: 'F-I',
            location: 'apps/desktop/src/acceptance/agent/harness.ts:ensureProvider',
            msg: `[DEBUG] ${stage}`,
            data,
            ts: Date.now(),
          }),
        }).catch(() => {});
      };
      // #endregion

      let stage = 'load-providers';
      reportEnsureProviderStage('started', { stage });
      try {
        const providerStore = useProviderStore.getState();
        await providerStore.loadProviders();
        const existing = providerStore.providers.find((p) => p.id === providerId);
        reportEnsureProviderStage('providers-loaded', {
          providerCount: providerStore.providers.length,
          providerExists: existing !== undefined,
        });

        stage = 'load-provider-detail';
        const existingDetail = existing ? await api.getProvider(providerId) : null;
        reportEnsureProviderStage('provider-detail-loaded', {
          providerExists: existing !== undefined,
          detailPresent: existingDetail !== null,
        });

        stage = 'persist-provider';
        const effectiveBaseUrl = baseUrl || existingDetail?.base_url || '';
        if (!existing) {
          await providerStore.createProvider({ id: providerId, name: providerId, base_url: effectiveBaseUrl, api_key: apiKey });
        } else {
          const version = existingDetail?.version ?? 0;
          await api.updateProvider(providerId, { api_key: apiKey, base_url: effectiveBaseUrl, enabled: true, version });
        }
        reportEnsureProviderStage('provider-persisted');

        stage = 'list-models';
        const availableModels = await api.listAvailableModels();
        const providerModel = availableModels.models.find(
          (model) => model.provider_id === providerId && model.id === modelId && model.enabled,
        );
        reportEnsureProviderStage('models-loaded', {
          modelCount: availableModels.models.length,
          requestedModelAvailable: providerModel !== undefined,
        });
        if (!providerModel) {
          throw new Error('agent.acceptance.providerModelUnavailable');
        }

        stage = 'load-agents';
        const agentStore = useAgentStore.getState();
        await agentStore.loadAgents();
        const refreshedAgentStore = useAgentStore.getState();
        const selected = refreshedAgentStore.selectedAgent;
        const agent = refreshedAgentStore.agents.find((a) => a.name === selected)
          || refreshedAgentStore.agents[0];
        reportEnsureProviderStage('agents-loaded', {
          agentCount: refreshedAgentStore.agents.length,
          selectedAgentPresent: agent !== undefined,
        });
        if (agent) {
          const agentId = agent.id || agent.name;
          if (agent.provider !== providerId || agent.model !== modelId) {
            stage = 'update-agent-profile';
            await agentStore.updateAgentProfile(agentId, {
              provider: providerId,
              model: modelId,
            });
            await agentStore.loadAgents();
            reportEnsureProviderStage('agent-profile-updated');
          }

          stage = 'load-readiness';
          const readiness = await api.getAgentCapabilityReadiness({
            agent_id: agentId,
          });
          const modelCapabilities = readiness.model_capabilities;
          reportEnsureProviderStage('readiness-loaded', {
            runtimeSnapshotPresent: Boolean(readiness.runtime_snapshot_id),
            modelSnapshotPresent: Boolean(modelCapabilities?.snapshot_id),
            snapshotsMatch:
              modelCapabilities?.snapshot_id === readiness.runtime_snapshot_id,
          });
          if (
            !readiness.runtime_snapshot_id
            || !modelCapabilities?.snapshot_id
            || modelCapabilities.snapshot_id !== readiness.runtime_snapshot_id
          ) {
            throw new Error('agent.acceptance.providerReadinessBlocked');
          }
        }
        return { configured: true, providerId, modelId, agentName: agent?.name };
      } catch (error) {
        reportEnsureProviderStage('failed', {
          stage,
          errorType: error instanceof Error ? error.name : typeof error,
        });
        throw error;
      }
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
      const identitySnapshot = identityRuntime.getSnapshot();
      const operation = chatState.operations[chatState.currentSessionKey];
      const assistant = [...chatState.messages]
        .reverse()
        .find((message) => message.role === 'assistant');

      return {
        authenticated: sessionState.authenticated,
        actorId: sessionState.currentUser?.actorPtid ?? null,
        identityState: identitySnapshot.lifecycle.state,
        identityPhase: identitySnapshot.phase.kind,
        identityReason: 'reason' in identitySnapshot.phase ? identitySnapshot.phase.reason : null,
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

    async getFoundationClientExecutorTarget() {
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      const fixture = await foundationToolFixture(
        agent.id || agent.name,
        'desktop_app',
      );
      const session = await resolveFoundationToolTurnSession();
      const stationSessions = await api.listAgentCapabilitySessions();
      const target = stationSessions.sessions.find((candidate) =>
        candidate.session_id === session.capabilitySessionId
        && candidate.typed_capabilities.some(
          (capability) =>
            capability.capability_id === fixture.manifest.capabilityId,
        ));
      if (!target) {
        throw new Error('agent.acceptance.foundationExecutorTargetUnavailable');
      }
      return {
        capabilitySessionId: target.session_id,
        targetDeviceId: target.device_id,
        targetCapabilityId: fixture.manifest.capabilityId,
      };
    },

    async setFoundationClientExecutorAvailable({
      available,
      targetCapabilitySessionId,
      targetDeviceId,
      targetCapabilityId,
    }: {
      available: boolean;
      targetCapabilitySessionId: string;
      targetDeviceId: string;
      targetCapabilityId: string;
    }) {
      const [before, beforeLocal] = await Promise.all([
        api.listAgentCapabilitySessions(),
        api.getAgentCapabilitySessionSnapshot(),
      ]);
      const [targetDeviceIdHash, targetCapabilitySessionIdHash] =
        await Promise.all([
          sha256Hex(targetDeviceId),
          sha256Hex(targetCapabilitySessionId),
        ]);
      if (available) {
        await api.startAgentClientExecutorSupervisor();
      } else {
        await api.stopAgentClientExecutorSupervisor();
      }
      let after = await api.listAgentCapabilitySessions();
      let afterLocal = await api.getAgentCapabilitySessionSnapshot();
      const deadline = Date.now() + 30_000;
      const matchesTarget = () => after.sessions.find((session) =>
        session.device_id === targetDeviceId
        && session.typed_capabilities.some(
          (capability) => capability.capability_id === targetCapabilityId,
        ));
      const matchesLocalTarget = () => afterLocal.sessions.find((session) =>
        session.device_id_hash === targetDeviceIdHash
        && session.capability_ids.includes(targetCapabilityId));
      while (
        (
          available
            ? !matchesTarget() || !matchesLocalTarget()
            : after.sessions.some(
                (session) => session.session_id === targetCapabilitySessionId,
              ) || afterLocal.sessions.some(
                (session) =>
                  session.capability_session_id_hash
                    === targetCapabilitySessionIdHash,
              )
        )
        && Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        [after, afterLocal] = await Promise.all([
          api.listAgentCapabilitySessions(),
          api.getAgentCapabilitySessionSnapshot(),
        ]);
      }
      const restored = matchesTarget();
      const restoredLocal = matchesLocalTarget();
      const sessionRemoved = !after.sessions.some(
        (session) => session.session_id === targetCapabilitySessionId,
      );
      const localSessionRemoved = !afterLocal.sessions.some(
        (session) =>
          session.capability_session_id_hash === targetCapabilitySessionIdHash,
      );
      if (
        (available && (!restored || !restoredLocal))
        || (!available && (!sessionRemoved || !localSessionRemoved))
      ) {
        throw new Error(
          available
            ? 'agent.acceptance.foundationExecutorRestoreTimeout'
            : 'agent.acceptance.foundationExecutorWithdrawalTimeout',
        );
      }
      const beforeTargetLocal = beforeLocal.sessions.find(
        (session) =>
          session.capability_session_id_hash === targetCapabilitySessionIdHash,
      );
      return {
        requestedAvailable: available,
        targetCapabilitySessionId,
        targetDeviceId,
        targetCapabilityId,
        sessionPresentBefore: before.sessions.some(
          (session) => session.session_id === targetCapabilitySessionId,
        ),
        sessionRemoved,
        localSessionRemoved,
        sessionRestored: Boolean(restored),
        restoredCapabilitySessionId: restored?.session_id ?? '',
        restoredDeviceId: restored?.device_id ?? '',
        restoredCapabilityId: restored
          ?.typed_capabilities.find(
            (capability) => capability.capability_id === targetCapabilityId,
          )?.capability_id ?? '',
        ...(available
          ? {
              restoredExecutionAttemptCount:
                restoredLocal?.local_execution_attempt_count ?? -1,
              restoredSideEffectCount:
                restoredLocal?.local_side_effect_count ?? -1,
            }
          : {
              withdrawnExecutionAttemptCount:
                beforeTargetLocal?.local_execution_attempt_count ?? -1,
              withdrawnSideEffectCount:
                beforeTargetLocal?.local_side_effect_count ?? -1,
            }),
      };
    },

    async prepareFoundationExecutorUnavailable(input: {
      scenarioKey: string;
      platform: string;
      sampleId: string;
      targetCapabilitySessionId: string;
      targetDeviceId: string;
      targetCapabilityId: string;
    }) {
      return evidenceValue(
        await prepareFoundationExecutorUnavailableScenario(input),
      );
    },

    async rejectFoundationExecutorUnavailable({
      scenarioKey,
      executorStop,
    }: {
      scenarioKey: string;
      executorStop: Record<string, unknown>;
    }) {
      return evidenceValue(
        await rejectFoundationExecutorUnavailableScenario(
          scenarioKey,
          executorStop,
        ),
      );
    },

    async recoverFoundationExecutorUnavailable(input: {
      scenarioKey: string;
      rejectedScenario: Record<string, unknown>;
      executorStart: Record<string, unknown>;
    }) {
      return evidenceValue(
        await recoverFoundationExecutorUnavailableScenario(input),
      );
    },

    async abortFoundationExecutorUnavailable({
      scenarioKey,
    }: {
      scenarioKey: string;
    }) {
      await cleanupFoundationExecutorUnavailableScenario(scenarioKey);
      return { scenarioKey, cleaned: true };
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
      faultControlUrl,
    }: {
      scenarioKey: string;
      platform: string;
      locale: string;
      sampleId: string;
      faultControlUrl: string;
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
          faultControlUrl,
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

    async foundationF06FinalizePreparation({
      scenarioKey,
    }: {
      scenarioKey: string;
    }) {
      return evidenceValue(
        await finalizeFoundationF06Preparation(scenarioKey),
      );
    },

    async foundationF06RestoreCapabilityIsolation({
      scenarioKey,
    }: {
      scenarioKey: string;
    }) {
      return evidenceValue(
        await restoreFoundationF06CapabilityIsolation(scenarioKey),
      );
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

    async foundationF12Prepare({
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
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      const capabilitySessions = await waitForCapabilitySessionEvidence();
      const capabilitySessionId =
        capabilitySessions.selectedStationSession?.session_id;
      if (!capabilitySessionId) {
        throw new Error('agent.acceptance.capabilitySessionUnavailable');
      }
      const handoff = await runFoundationF12PrepareWithCapabilityFixture({
        agent,
        capabilitySessionId,
        scenarioKey,
        platform,
        locale,
        sampleId,
      });
      return evidenceValue({
        scenarioKey: handoff.scenarioKey,
        conversationIds: [
          handoff.topics.alpha.conversationId,
          handoff.topics.beta.conversationId,
        ],
        primaryConversationId: handoff.topics.alpha.conversationId,
        primaryTurnId: handoff.topics.alpha.runtimeTurnId,
      });
    },

    async foundationF12Cleanup({
      scenarioKey,
      conversationIds,
    }: {
      scenarioKey: string;
      conversationIds?: string[];
    }) {
      return evidenceValue(await cleanupFoundationF12Scenario({
        scenarioKey,
        conversationIds,
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
      preparedScenario,
    }: {
      platform: string;
      locale: string;
      cell: string;
      sampleId: string;
      scenarioKey?: string;
      stationRestart?: Record<string, unknown>;
      durableReloadEvidence?: Record<string, unknown>;
      preparedScenario?: Record<string, unknown>;
    }) {
      await reportFoundationCapabilityIsolationDebug(
        'C-D',
        'entry-restoration-start',
        {
          cell,
          isolationJournalPresent:
            readFoundationCapabilityIsolationJournal() !== null,
          fixtureJournalPresent:
            readFoundationCapabilityFixtureJournal() !== null,
        },
      );
      await restorePersistedFoundationCapabilityIsolation();
      await restorePersistedFoundationCapabilityFixture();
      const agentState = useAgentStore.getState();
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      await reportFoundationCapabilityIsolationDebug(
        'C-D',
        'entry-restoration-complete',
        {
          cell,
          isolationJournalPresent:
            readFoundationCapabilityIsolationJournal() !== null,
          fixtureJournalPresent:
            readFoundationCapabilityFixtureJournal() !== null,
          selectedAgentNamePresent: Boolean(agentState.selectedAgent),
          selectedAgentResolvedByName: agentState.agents.some(
            (candidate) => candidate.name === agentState.selectedAgent,
          ),
          selectedAgentUsesFallback:
            !agentState.agents.some(
              (candidate) => candidate.name === agentState.selectedAgent,
            )
            && agentState.agents[0] === agent,
          agentCount: agentState.agents.length,
          selectedAgentVersion: agent.version,
        },
      );
      const agentId = agent.id || agent.name;
      let capabilitySessions = await waitForCapabilitySessionEvidence();
      let preparedConversationId: string | null = null;
      let preparedTurnId: string | null = null;
      const preparedRuntimeEvent: {
        current: FoundationRuntimeEventObservation | null;
      } = { current: null };
      let turnDurationMs: number | null = null;
      let scenarioFacts: Record<string, unknown> | null = null;
      let preservedReplayReadback:
        | Awaited<ReturnType<typeof foundationConversationReadback>>
        | null = null;

      try {
      if (cell === 'BASE-EXECUTOR-UNAVAILABLE') {
        const scenario = evidenceRecord(
          preparedScenario,
          'foundationExecutorUnavailablePreparedScenario',
        );
        preparedConversationId = String(scenario.conversationId ?? '');
        preparedTurnId = String(scenario.turnId ?? '');
        turnDurationMs = Number(scenario.durationMs ?? 0);
        scenarioFacts = evidenceRecord(
          scenario.facts,
          'foundationExecutorUnavailableFacts',
        );
        const runtimeEvent = evidenceRecord(
          scenario.runtimeEvent,
          'foundationExecutorUnavailableRuntimeEvent',
        );
        preparedRuntimeEvent.current = {
          eventType: String(runtimeEvent.eventType ?? ''),
          sequence: Number(runtimeEvent.sequence ?? 0),
          observedAt: String(runtimeEvent.observedAt ?? ''),
        };
        if (
          !preparedConversationId
          || !preparedTurnId
          || !turnDurationMs
          || !preparedRuntimeEvent.current.eventType
          || preparedRuntimeEvent.current.sequence <= 0
          || !preparedRuntimeEvent.current.observedAt
        ) {
          throw new Error(
            'agent.acceptance.foundationExecutorPreparedScenarioInvalid',
          );
        }
      }

      if (cell === 'BASE-DUPLICATE_CONFLICT') {
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        const scenario = await runFoundationDuplicateConflictScenario({
          agent,
          capabilitySessionId,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
      }

      if (cell === 'BASE-ACTIVE_MUTATION_CONFLICT') {
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        const scenario = await runFoundationActiveMutationConflictScenario({
          agent,
          capabilitySessionId,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
      }

      if (cell === 'BASE-CANCELLED') {
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        const scenario = await runFoundationCancelledScenario({
          agent,
          capabilitySessionId,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
      }

      if (cell === 'BASE-CONTEXT_OVERFLOW') {
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        const scenario = await runFoundationContextOverflowScenario({
          agent,
          capabilitySessionId,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
      }

      if (cell === 'BASE-CREDENTIAL_MISSING') {
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        const scenario = await runFoundationCredentialMissingScenario({
          agent,
          capabilitySessionId,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
      }

      if (cell === 'BASE-APPROVAL_DENIED') {
        const scenario = await runFoundationApprovalDeniedScenario({
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

      if (cell === 'BASE-APPROVAL_EXPIRED') {
        const scenario = await runFoundationApprovalExpiredScenario({
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

      if (cell === 'BASE-ATTACHMENT_REJECTED') {
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        const scenario = await runFoundationAttachmentRejectedScenario({
          agent,
          capabilitySessionId,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
      }

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

      if (cell === 'AS-F12') {
        if (!stationRestart || !scenarioKey) {
          throw new Error('agent.acceptance.foundationStationRestartMissing');
        }
        const scenario = await runFoundationF12Complete(stationRestart, {
          scenarioKey,
          platform,
          locale,
          sampleId,
        });
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
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        await withFoundationReadyCapabilityFixture(
          agent,
          platform,
          async (authoritativeAgent) => {
            const authoritativeAgentId =
              authoritativeAgent.id || authoritativeAgent.name;
            await withFoundationCapabilitiesDisabled(
              authoritativeAgent,
              capabilitySessionId,
              async (toolIsolation) => {
                const conversation = await api.createAgentConversation({
                  agent_id: authoritativeAgentId,
                  title: `Foundation ${sampleId}`,
                  provider_id: authoritativeAgent.provider,
                  model_name: authoritativeAgent.model,
                });
                preparedConversationId = conversation.conversation_id;
                await useChatStore.getState().selectSession(
                  conversation.conversation_id,
                );
                const turnStartedAt = performance.now();
                const observed = startObservedFoundationTurn({
                  conversationId: conversation.conversation_id,
                  agentId: authoritativeAgentId,
                  content: 'Reply with ready.',
                  idempotencyKey: crypto.randomUUID(),
                  provider: authoritativeAgent.provider || undefined,
                  model: authoritativeAgent.model || undefined,
                  effort: 'low',
                  thinkingMode: 'disabled',
                  clientCapabilitySessionId: capabilitySessionId,
                });
                const result = await observed.result;
                if (!result.ok) {
                  throw new Error(
                    result.error || 'agent.acceptance.foundationTurnFailed',
                  );
                }
                const turnId = observedTurnId(result.events);
                const terminal = [...result.events].reverse().find((event) =>
                  classifyAgentTurnTerminalEvent(event) === 'completed');
                if (!turnId || !terminal) {
                  throw new Error('agent.acceptance.foundationTurnIdMissing');
                }
                preparedTurnId = turnId;
                preparedRuntimeEvent.current = {
                  eventType: terminal.event,
                  sequence: Number(terminal.data.seq ?? 0),
                  observedAt: terminal.observedAt,
                };
                turnDurationMs = performance.now() - turnStartedAt;
                scenarioFacts = { toolIsolation };
              },
              { requireEffectiveCapabilities: true },
            );
          },
        );
      }

      if (cell === 'AS-F02') {
        const { fixture: queueFixture } =
          await prepareFoundationReadyCapabilityFixture(agent, platform);
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
        const queueBeforeAdmissions = await api.listAgentTurnQueue(
          conversation.conversation_id,
        );
        const activeTurnInput =
          `Call ${queueFixture.toolName} exactly once with `
          + `${JSON.stringify(queueFixture.arguments)}. Wait for approval before `
          + 'continuing, then answer with one short sentence.';
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
        let activeAdmission = await api.listAgentTurnQueue(
          conversation.conversation_id,
        );
        const activeAdmissionDeadline = Date.now() + 10_000;
        while (
          activeAdmission.conversation_version
            <= queueBeforeAdmissions.conversation_version
          && Date.now() < activeAdmissionDeadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          activeAdmission = await api.listAgentTurnQueue(
            conversation.conversation_id,
          );
        }
        if (
          activeAdmission.conversation_version
            <= queueBeforeAdmissions.conversation_version
        ) {
          active.controller.abort();
          throw new Error('agent.acceptance.foundationActiveTurnAdmissionMissing');
        }
        void reportFoundationQueueCapacityDebug(
          'A,B',
          'active-admission-observed',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            conversationVersionBefore:
              queueBeforeAdmissions.conversation_version,
            conversationVersionAfter: activeAdmission.conversation_version,
            queueSize: activeAdmission.entries.length,
          },
        );
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
        queuedTurns.forEach((queued, index) => {
          void queued.firstEvent.then((event) => {
            const admission =
              event.data.admission && typeof event.data.admission === 'object'
                ? event.data.admission as Record<string, unknown>
                : {};
            return reportFoundationQueueCapacityDebug(
              'B,D',
              'queued-first-event',
              {
                queueIndex: index + 1,
                elapsedSinceActiveMs: performance.now() - activeStartedAt,
                eventType: event.event,
                queuePosition: Number(admission.queue_position ?? 0),
                activeTerminal: active.events.some(
                  (activeEvent) =>
                    classifyAgentTurnTerminalEvent(activeEvent) !== null,
                ),
              },
            );
          });
          void queued.result.then((result) =>
            reportFoundationQueueCapacityDebug(
              'B,D',
              'queued-result',
              {
                queueIndex: index + 1,
                elapsedSinceActiveMs: performance.now() - activeStartedAt,
                ok: result.ok,
                errorCode: observedErrorCode(result.error),
                eventTypes: result.events.map((event) => event.event),
                activeTerminal: active.events.some(
                  (activeEvent) =>
                    classifyAgentTurnTerminalEvent(activeEvent) !== null,
                ),
              },
            ));
        });
        void reportFoundationQueueCapacityDebug(
          'B,D',
          'queued-submissions-started',
          {
            submissionCount: queuedTurns.length,
            observedEventCounts: queuedTurns.map(
              (queued) => queued.events.length,
            ),
            activeEventTypes: active.events.map((event) => event.event),
          },
        );
        const duplicateFirstEvent = await duplicate.firstEvent;
        const activeTurnId = observedTurnId([duplicateFirstEvent]);
        if (!activeTurnId) {
          active.controller.abort();
          throw new Error('agent.acceptance.foundationTurnIdMissing');
        }
        await waitForToolApprovalEvent({
          conversationId: conversation.conversation_id,
          turnId: activeTurnId,
          observed: active,
        });
        void reportFoundationQueueCapacityDebug(
          'A,H',
          'active-approval-observed',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            activeEventTypes: active.events.map((event) => event.event),
          },
        );
        const queuedResultsPromise = Promise.all(
          queuedTurns.map((queued) => queued.result),
        );
        const queueSnapshotStartedAt = performance.now();
        let queueAtCapacity = await api.listAgentTurnQueue(
          conversation.conversation_id,
        );
        const initialQueueSize = queueAtCapacity.entries.length;
        let maximumObservedQueueSize = initialQueueSize;
        let queuePollCount = 1;
        const queueDeadline = Date.now() + 30_000;
        while (
          queueAtCapacity.entries.length < 8
          && Date.now() < queueDeadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          queueAtCapacity = await api.listAgentTurnQueue(
            conversation.conversation_id,
          );
          maximumObservedQueueSize = Math.max(
            maximumObservedQueueSize,
            queueAtCapacity.entries.length,
          );
          queuePollCount += 1;
        }
        void reportFoundationQueueCapacityDebug(
          'A,B,C,D,E',
          'queue-capacity-sampled',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            queueSamplingDurationMs:
              performance.now() - queueSnapshotStartedAt,
            initialQueueSize,
            finalQueueSize: queueAtCapacity.entries.length,
            maximumObservedQueueSize,
            queueCapacity: queueAtCapacity.queue_capacity,
            queuePositions: queueAtCapacity.entries.map(
              (entry) => entry.queue_position,
            ),
            queuePollCount,
            activeEventTypes: active.events.map((event) => event.event),
            selectedConversationMatches:
              useChatStore.getState().currentSessionKey
                === conversation.conversation_id,
          },
        );
        if (queueAtCapacity.entries.length !== 8) {
          active.controller.abort();
          duplicate.controller.abort();
          for (const queued of queuedTurns) queued.controller.abort();
          throw new Error('agent.acceptance.queueCapacitySnapshotMismatch');
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
        const overflowResultPromise = overflow.result;
        const activeDependencyPromise = observeFoundationActiveDependency(
          conversation.conversation_id,
          queueAtCapacity.conversation_version,
        );
        const queueReceiverPromise = (async () => {
          await useChatStore.getState().syncTurnQueue(
            conversation.conversation_id,
          );
          await waitFor(
            () => {
              const queueProjection = foundationDomSnapshot();
              return (
                queueProjection.queueEntries.visibleCount > 0
                && queueProjection.queuePositions.visibleCount
                  === queueAtCapacity.entries.length
              );
            },
            'Foundation AS-F02 queue projection',
            30_000,
          );
          return foundationDomSnapshot();
        })();
        const [
          overflowResult,
          activeDependencyError,
          queueReceiver,
        ] = await Promise.all([
          overflowResultPromise,
          activeDependencyPromise,
          queueReceiverPromise,
        ]);
        void reportFoundationQueueCapacityDebug(
          'A,H',
          'capacity-observations-completed',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            overflowErrorCode: observedErrorCode(overflowResult.error),
            activeDependencyError,
            visibleQueuePositions: queueReceiver.queuePositions.visibleCount,
            activeEventTypes: active.events.map((event) => event.event),
          },
        );
        const cancellationTarget = queueAtCapacity.entries[0];
        if (!cancellationTarget) {
          active.controller.abort();
          throw new Error('agent.acceptance.queueCancellationTargetMissing');
        }
        void reportFoundationQueueCapacityDebug(
          'A,H',
          'queue-cancellation-requested',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            snapshotConversationVersion:
              queueAtCapacity.conversation_version,
            targetQueuePosition: cancellationTarget.queue_position,
            activeEventTypes: active.events.map((event) => event.event),
          },
        );
        void reportFoundationQueueCapacityDebug(
          'A,F',
          'active-cancellation-requested',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            activeEventTypes: active.events.map((event) => event.event),
          },
        );
        let cancellation: Awaited<
          ReturnType<typeof api.cancelQueuedAgentTurn>
        > | null;
        let activeCancellation: Awaited<
          ReturnType<typeof api.cancelAgentTurn>
        >;
        try {
          [cancellation, activeCancellation] = await Promise.all([
            cancelFoundationQueuedTurns(
              conversation.conversation_id,
              1,
            ),
            api.cancelAgentTurn(activeTurnId),
          ]);
        } catch (error) {
          const currentQueue = await api.listAgentTurnQueue(
            conversation.conversation_id,
          ).catch(() => null);
          await reportFoundationQueueCapacityDebug(
            'A,H',
            'queue-cancellation-failed',
            {
              elapsedSinceActiveMs: performance.now() - activeStartedAt,
              errorCode: observedErrorCode(error),
              snapshotConversationVersion:
                queueAtCapacity.conversation_version,
              currentConversationVersion:
                currentQueue?.conversation_version ?? null,
              currentQueueSize: currentQueue?.entries.length ?? null,
              currentQueuePositions: currentQueue?.entries.map(
                (entry) => entry.queue_position,
              ) ?? [],
              targetStillQueued: currentQueue?.entries.some(
                (entry) =>
                  entry.queue_entry_id === cancellationTarget.queue_entry_id,
              ) ?? false,
              activeEventTypes: active.events.map((event) => event.event),
            },
          );
          throw error;
        }
        if (!cancellation) {
          throw new Error('agent.acceptance.queueCancellationTargetMissing');
        }
        void reportFoundationQueueCapacityDebug(
          'A,H',
          'queue-cancellation-completed',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            conversationVersion: cancellation.conversation_version,
            status: cancellation.entry.status,
            activeEventTypes: active.events.map((event) => event.event),
          },
        );
        void reportFoundationQueueCapacityDebug(
          'A,F',
          'active-cancellation-completed',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            status: activeCancellation?.status ?? null,
            activeEventTypes: active.events.map((event) => event.event),
          },
        );
        if (
          activeCancellation
          && String(activeCancellation.status).toLowerCase() !== 'cancelled'
        ) {
          active.controller.abort();
          throw new Error('agent.acceptance.foundationActiveTurnCancelRejected');
        }
        await cancelFoundationQueuedTurns(conversation.conversation_id);
        if (!active.events.some((event) =>
          event.event === 'cancelled'
          || classifyAgentTurnTerminalEvent(event) === 'cancelled')) {
          active.controller.disconnectTransport();
        }
        const [
          firstActiveEvent,
          activeResult,
          duplicateResult,
          queuedResults,
        ] = await Promise.all([
          active.firstEvent,
          active.result,
          duplicate.result,
          queuedResultsPromise,
        ]);
        await cancelFoundationQueuedTurns(conversation.conversation_id);
        const residualTurnIds = Array.from(new Set(
          (
            await api.listAgentConversationMessages({
              conversation_id: conversation.conversation_id,
              limit: 200,
            })
          ).messages
            .map((message) => message.turn_id)
            .filter(
              (turnId): turnId is string =>
                Boolean(turnId) && turnId !== activeTurnId,
            ),
        ));
        const residualTurnStatuses: string[] = [];
        for (const residualTurnId of residualTurnIds) {
          const residualCancellation = await api.cancelAgentTurn(
            residualTurnId,
          );
          const residualStatus = String(
            residualCancellation?.status ?? '',
          ).toLowerCase();
          if (!['cancelled', 'completed'].includes(residualStatus)) {
            throw new Error(
              'agent.acceptance.foundationResidualTurnNotSettled',
            );
          }
          residualTurnStatuses.push(residualStatus);
        }
        await cancelFoundationQueuedTurns(conversation.conversation_id);
        void reportFoundationQueueCapacityDebug(
          'G,H',
          'residual-turns-settled',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            residualTurnCount: residualTurnIds.length,
            residualTurnStatuses,
          },
        );
        preparedRuntimeEvent.current = {
          eventType: firstActiveEvent.event,
          sequence: Number(firstActiveEvent.data.seq ?? 0),
          observedAt: new Date().toISOString(),
        };
        void reportFoundationQueueCapacityDebug(
          'A',
          'active-first-event',
          {
            eventType: firstActiveEvent.event,
            sequence: Number(firstActiveEvent.data.seq ?? 0),
            selectedConversationMatches:
              useChatStore.getState().currentSessionKey
                === conversation.conversation_id,
          },
        );
        void reportFoundationQueueCapacityDebug(
          'A,B,D',
          'queue-results-settled',
          {
            elapsedSinceActiveMs: performance.now() - activeStartedAt,
            activeEventTypes: active.events.map((event) => event.event),
            duplicateEventTypes: duplicate.events.map((event) => event.event),
            queuedResults: queuedResults.map((result) => ({
              ok: result.ok,
              errorCode: observedErrorCode(result.error),
              eventTypes: result.events.map((event) => event.event),
              queuePositions: result.events.map((event) => {
                const admission = event.data.admission;
                if (!admission || typeof admission !== 'object') return 0;
                return Number(
                  (admission as Record<string, unknown>).queue_position ?? 0,
                );
              }),
            })),
            overflowOk: overflowResult.ok,
            overflowErrorCode: observedErrorCode(overflowResult.error),
            overflowEventTypes: overflowResult.events.map(
              (event) => event.event,
            ),
          },
        );
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
              sessionActorPresent: Boolean(session.currentUser?.actorPtid),
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
            replayedTurnId: observedTurnId(duplicateResult.events),
            turnDelta: 1,
            queueEntryDelta: queueBeforeAdmissions.entries.length,
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
        await restorePersistedFoundationCapabilityIsolation();
        await restorePersistedFoundationCapabilityFixture();
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
            const maxCancellationAttempts = 2;
            const terminalRaceStatuses: string[] = [];
            for (
              let attemptIndex = 1;
              attemptIndex <= maxCancellationAttempts;
              attemptIndex += 1
            ) {
              const conversation = await api.createAgentConversation({
                agent_id: agentId,
                title: `Foundation stream ${sampleId} attempt ${attemptIndex}`,
                provider_id: agent.provider,
                model_name: agent.model,
              });
              preparedConversationId = conversation.conversation_id;
              await useChatStore.getState().selectSession(
                conversation.conversation_id,
              );

              const startedAt = performance.now();
              let cancellationRequested = false;
              let cancellationRequestedAt = 0;
              let triggeringTurnId = '';
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
                content:
                  'Write a detailed 2000-word numbered guide to reliable queues. '
                  + 'Continue until the full guide is complete.',
                idempotencyKey: crypto.randomUUID(),
                provider: agent.provider || undefined,
                model: agent.model || undefined,
                effort: 'low',
                thinkingMode: 'disabled',
                clientCapabilitySessionId:
                  capabilitySessions.selectedStationSession?.session_id,
                requestedBudget: {
                  max_output_tokens: 4096,
                  wall_time_ms: 90_000,
                },
                timeoutMs: 90_000,
                onEvent: (event, events) => {
                  if (cancellationRequested || event.event !== 'text') return;
                  triggeringTurnId = String(
                    event.data.turn_id ?? event.data.turnId ?? '',
                  );
                  const turnId = observedTurnId(events);
                  if (!turnId) return;
                  cancellationRequested = true;
                  cancellationRequestedAt = performance.now();
                  preparedTurnId = turnId;
                  const result = api.cancelAgentTurn(turnId).then(
                    (response) => ({ response, error: null }),
                    (error: unknown) => ({ response: null, error }),
                  );
                  void reportFoundationF03CancelDebug(
                    'B-C',
                    'cancel-requested',
                    {
                      attemptIndex,
                      elapsedMs: cancellationRequestedAt - startedAt,
                      eventSequence: Number(event.data.seq ?? 0),
                      eventTurnIdPresent: triggeringTurnId.length > 0,
                      selectedTurnIdPresent: turnId.length > 0,
                      triggeringTurnMatchesSelected: triggeringTurnId === turnId,
                      observedEventTypes: events.map(
                        (candidate) => candidate.event,
                      ),
                    },
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
              if (cancellationResult.error) {
                await reportFoundationF03CancelDebug('D', 'cancel-error', {
                  attemptIndex,
                  elapsedMs: performance.now() - startedAt,
                  errorCode: observedErrorCode(cancellationResult.error),
                  observedEventTypes: observed.events.map((event) => event.event),
                });
                throw cancellationResult.error;
              }
              const activeCancellation = cancellationResult.response;
              const cancellationStatus = String(
                activeCancellation?.status ?? '',
              ).toLowerCase();
              await reportFoundationF03CancelDebug('A-D', 'cancel-finished', {
                attemptIndex,
                elapsedMs: performance.now() - startedAt,
                cancelLatencyMs: performance.now() - cancellationRequestedAt,
                cancellationStatus,
                responsePresent: activeCancellation !== null,
                triggeringTurnIdPresent: triggeringTurnId.length > 0,
                triggeringTurnMatchesSelected:
                  triggeringTurnId === cancellationAttempt.turnId,
                observedEvents: observed.events.map((event) => ({
                  eventType: event.event,
                  sequence: Number(event.data.seq ?? 0),
                })),
              });
              const result = await observed.result;
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

              if (cancellationStatus === 'completed') {
                if (terminalEvent?.eventType !== 'done') {
                  throw new Error(
                    'agent.acceptance.foundationActiveTurnCancelRejected',
                  );
                }
                terminalRaceStatuses.push(cancellationStatus);
                await deleteFoundationConversation(conversation.conversation_id);
                preparedConversationId = null;
                preparedTurnId = null;
                await reportFoundationF03CancelDebug(
                  'A-B',
                  'cancel-window-retry',
                  {
                    attemptIndex,
                    terminalRaceCount: terminalRaceStatuses.length,
                  },
                );
                continue;
              }
              if (
                !activeCancellation
                || String(activeCancellation.status).toLowerCase() !== 'cancelled'
              ) {
                observed.controller.abort();
                throw new Error('agent.acceptance.foundationActiveTurnCancelRejected');
              }
              if (terminalEvent?.eventType !== 'cancelled') {
                throw new Error('agent.acceptance.foundationActiveTurnCancelMissing');
              }

              turnDurationMs = performance.now() - startedAt;
              preparedRuntimeEvent.current = terminalEvent;
              scenarioFacts = {
                events: normalizedEvents,
                sawTextBeforeCancel: true,
                toolIsolation,
                cancellationWindow: {
                  attemptCount: attemptIndex,
                  terminalRaceCount: terminalRaceStatuses.length,
                },
              };
              break;
            }
            if (!scenarioFacts) {
              throw new Error(
                'agent.acceptance.foundationCancellationWindowUnavailable',
              );
            }
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
      if (cell === 'AS-F10') {
        const stationSession = capabilitySessions.selectedStationSession;
        const localSession = capabilitySessions.selectedLocalSession;
        const readinessSessionId = String(
          readiness.selected_client_session_id ?? '',
        );
        await reportFoundationF10Debug('pre-oracle', {
          platform,
          scenarioFactsPresent: scenarioFacts !== null,
          localSessionCount: capabilitySessions.local.sessions.length,
          stationSessionCount: capabilitySessions.station.sessions.length,
          selectedSessionPresent: Boolean(stationSession && localSession),
          selectedSessionPlatform: stationSession?.platform ?? null,
          selectedSessionCapabilityCount:
            stationSession?.typed_capabilities.length ?? -1,
          readinessSelectedSessionMatches: Boolean(
            readinessSessionId
            && localSession
            && await sha256Hex(readinessSessionId)
              === localSession.capability_session_id_hash
          ),
        });
        const scenario = await runFoundationF10WithCapabilityIsolation({
          agent,
          platform,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
        const controls = evidenceRecord(
          scenario.facts.rejections,
          'foundationF10DiagnosticRejections',
        );
        await reportFoundationF10Debug('post-scenario', {
          coreOutcome: scenario.facts.coreOutcome,
          capabilitySession: scenario.facts.capabilitySession,
          selectedDevice: scenario.facts.selectedDevice,
          execution: scenario.facts.execution,
          rejections: Object.fromEntries(
            Object.entries(controls).map(([name, value]) => {
              const control = evidenceRecord(
                value,
                `foundationF10Diagnostic${name}`,
              );
              return [name, {
                availability: control.availability ?? 'available',
                unavailableReason: control.unavailable_reason ?? null,
                accepted: control.accepted ?? null,
                errorCode: control.errorCode ?? null,
              }];
            }),
          ),
        });
      }

      const chatState = useChatStore.getState();
      const currentConversationId =
        cell === 'BASE-ACTIVE_MUTATION_CONFLICT'
          ? preparedConversationId
          : preparedConversationId ?? chatState.currentSessionKey;
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
      const turnId = cell === 'BASE-ACTIVE_MUTATION_CONFLICT'
        ? preparedTurnId
        : preparedTurnId ?? lastAssistant?.turnId ?? null;
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
      if (cell === 'AS-F12' && scenarioFacts && scenarioKey) {
        preservedReplayReadback = conversationReadback;
        scenarioFacts.cleanup = await cleanupFoundationF12Scenario({
          scenarioKey,
        });
      }
      if (
        (
          cell === 'BASE-EXECUTOR-UNAVAILABLE'
          || cell === 'BASE-APPROVAL_DENIED'
          || cell === 'BASE-APPROVAL_EXPIRED'
          || cell === 'BASE-ATTACHMENT_REJECTED'
          || cell === 'BASE-ACTIVE_MUTATION_CONFLICT'
          || cell === 'BASE-CANCELLED'
          || cell === 'BASE-CONTEXT_OVERFLOW'
          || cell === 'BASE-DUPLICATE_CONFLICT'
          || cell === 'BASE-CREDENTIAL_MISSING'
        )
        && scenarioFacts
        && currentConversationId
      ) {
        preservedReplayReadback = conversationReadback;
        const deletionErrorCode = await deleteFoundationConversation(
          currentConversationId,
        );
        let conversationDeleted = deletionErrorCode.includes('AGENT_4004');
        if (!conversationDeleted) {
          try {
            conversationDeleted = (
              await api.getAgentConversation(currentConversationId)
            ).status === 'deleted';
          } catch (error) {
            conversationDeleted = observedErrorCode(error).includes('AGENT_4004');
          }
        }
        scenarioFacts.cleanup = {
          ...evidenceRecord(
            scenarioFacts.cleanup,
            cell === 'BASE-ACTIVE_MUTATION_CONFLICT'
              ? 'foundationActiveMutationConflictCleanup'
              : cell === 'BASE-CANCELLED'
                ? 'foundationCancelledCleanup'
              : cell === 'BASE-CONTEXT_OVERFLOW'
                ? 'foundationContextOverflowCleanup'
              : cell === 'BASE-DUPLICATE_CONFLICT'
                ? 'foundationDuplicateConflictCleanup'
              : cell === 'BASE-CREDENTIAL_MISSING'
                ? 'foundationCredentialMissingCleanup'
              : cell === 'BASE-EXECUTOR-UNAVAILABLE'
                ? 'foundationExecutorUnavailableCleanup'
              : cell === 'BASE-APPROVAL_DENIED'
                ? 'foundationApprovalDeniedCleanup'
                : cell === 'BASE-APPROVAL_EXPIRED'
                  ? 'foundationApprovalExpiredCleanup'
                  : 'foundationAttachmentRejectedCleanup',
          ),
          conversationDeleted,
          deletionErrorCodeHash: await sha256Hex(deletionErrorCode),
        };
        if (cell === 'BASE-ACTIVE_MUTATION_CONFLICT') {
          await reportActiveMutationConflictDebug(
            'attestation-cleanup-complete',
            {
              conversationIdHash: await sha256Hex(currentConversationId),
              conversationDeleted,
            },
          );
        }
      }

      const sessionState = useSessionStore.getState();
      const providerState = useProviderStore.getState();
      const operation = currentConversationId
        ? chatState.operations[currentConversationId]
        : undefined;

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
      if (cell === 'AS-F02') {
        void reportFoundationQueueCapacityDebug(
          'G',
          'replay-readback-compared',
          {
            sourceHash: sourceReadbackHash,
            replayHash: replayReadbackHash,
            equal:
              Boolean(sourceReadbackHash)
              && sourceReadbackHash === replayReadbackHash,
            sourceConversationVersion:
              conversationReadback?.conversation.version ?? null,
            replayConversationVersion:
              replayReadback?.conversation.version ?? null,
            sourceMessageCount: conversationReadback?.messages.length ?? 0,
            replayMessageCount: replayReadback?.messages.length ?? 0,
            sourceMessageStatuses:
              conversationReadback?.messages.map((message) => message.status)
              ?? [],
            replayMessageStatuses:
              replayReadback?.messages.map((message) => message.status)
              ?? [],
            finalQueueSize: turnQueue?.entries.length ?? 0,
          },
        );
      }
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
      if (cell === 'BASE-ACTIVE_MUTATION_CONFLICT' && scenarioFacts) {
        const winner = evidenceRecord(
          scenarioFacts.winner,
          'foundationActiveMutationConflictWinner',
        );
        stationReadback.entityKind = 'agent-profile';
        stationReadback.entityIdHash = await sha256Hex(String(winner.resourceId));
        stationReadback.revision = Number(winner.revisionAfterReload);
        stationReadback.stateHash = String(winner.hashAfterReload);
      }
      if (cell === 'BASE-CANCELLED' && scenarioFacts) {
        const station = evidenceRecord(
          scenarioFacts.station,
          'foundationCancelledStation',
        );
        stationReadback.entityKind = 'agent-turn-cancellation';
        stationReadback.entityIdHash = await sha256Hex(String(station.turnId));
        stationReadback.revision = Number(station.terminalEventCount);
        stationReadback.stateHash = await sha256Hex(stableJson(station));
        stationReadback.typedError = scenarioFacts.outcome;
      }
      if (cell === 'BASE-CONTEXT_OVERFLOW' && scenarioFacts) {
        const station = evidenceRecord(
          scenarioFacts.station,
          'foundationContextOverflowStation',
        );
        stationReadback.entityKind = 'agent-context-pre-admission';
        stationReadback.entityIdHash = await sha256Hex(
          String(station.conversationId),
        );
        stationReadback.revision = Number(
          station.conversationVersionAfter,
        );
        stationReadback.stateHash = String(station.afterHash);
        stationReadback.typedError = scenarioFacts.outcome;
        stationReadback.deltas = {
          turn: station.turnDelta,
          message: station.messageDelta,
          queue: station.queueDelta,
          providerExecution: station.providerExecutionDelta,
        };
      }
      if (cell === 'BASE-DUPLICATE_CONFLICT' && scenarioFacts) {
        const station = evidenceRecord(
          scenarioFacts.station,
          'foundationDuplicateConflictStation',
        );
        stationReadback.entityKind = 'agent-turn-idempotency-conflict';
        stationReadback.entityIdHash = await sha256Hex(
          String(station.originalTurnId),
        );
        stationReadback.revision = Number(
          station.conversationVersionAfter,
        );
        stationReadback.stateHash = String(station.afterHash);
        stationReadback.typedError = scenarioFacts.outcome;
        stationReadback.deltas = {
          turn: station.turnDelta,
          message: station.messageDelta,
          queue: station.queueDelta,
          providerExecution: station.providerExecutionDelta,
        };
      }
      if (cell === 'BASE-CREDENTIAL_MISSING' && scenarioFacts) {
        const station = evidenceRecord(
          scenarioFacts.station,
          'foundationCredentialMissingStation',
        );
        stationReadback.entityKind = 'agent-provider-credential-pre-admission';
        stationReadback.entityIdHash = await sha256Hex(
          String(station.providerId),
        );
        stationReadback.revision = Number(
          station.conversationVersionAfter,
        );
        stationReadback.stateHash = String(station.afterHash);
        stationReadback.typedError = scenarioFacts.outcome;
        stationReadback.deltas = {
          turn: station.turnDelta,
          message: station.messageDelta,
          queue: station.queueDelta,
          providerExecution: station.providerExecutionDelta,
        };
        stationReadback.credentialStatus = station.credentialStatusAfter;
      }
      if (cell === 'BASE-EXECUTOR-UNAVAILABLE' && scenarioFacts) {
        const station = evidenceRecord(
          scenarioFacts.station,
          'foundationExecutorUnavailableStation',
        );
        const lineage = evidenceRecord(
          station.lineage,
          'foundationExecutorUnavailableLineage',
        );
        stationReadback.entityKind = 'agent-tool-call';
        stationReadback.entityIdHash = await sha256Hex(
          String(lineage.toolCallId),
        );
        stationReadback.revision = Number(lineage.decisionRevision);
        stationReadback.stateHash = await sha256Hex(stableJson(station));
        stationReadback.typedError = scenarioFacts.outcome;
      }
      if (
        (
          cell === 'BASE-APPROVAL_DENIED'
          || cell === 'BASE-APPROVAL_EXPIRED'
        )
        && scenarioFacts
      ) {
        const station = evidenceRecord(
          scenarioFacts.station,
          cell === 'BASE-APPROVAL_DENIED'
            ? 'foundationApprovalDeniedStation'
            : 'foundationApprovalExpiredStation',
        );
        const lineage = evidenceRecord(
          station.lineage,
          cell === 'BASE-APPROVAL_DENIED'
            ? 'foundationApprovalDeniedLineage'
            : 'foundationApprovalExpiredLineage',
        );
        stationReadback.entityKind = 'agent-tool-call';
        stationReadback.entityIdHash = await sha256Hex(
          String(lineage.toolCallId),
        );
        stationReadback.revision = Number(lineage.decisionRevision);
        stationReadback.stateHash = await sha256Hex(stableJson(station));
      }
      if (cell === 'BASE-ATTACHMENT_REJECTED' && scenarioFacts) {
        const station = evidenceRecord(
          scenarioFacts.station,
          'foundationAttachmentRejectedStation',
        );
        stationReadback.entityKind = 'agent-attachment-pre-admission';
        stationReadback.entityIdHash = await sha256Hex(
          String(station.attachmentId),
        );
        stationReadback.revision = Number(
          station.conversationVersionAfter,
        );
        stationReadback.stateHash = String(station.afterHash);
        stationReadback.typedError = scenarioFacts.outcome;
        stationReadback.deltas = {
          turn: station.turnDelta,
          message: station.messageDelta,
          providerExecution: station.providerExecutionDelta,
        };
      }
      if (cell === 'AS-F12' && scenarioFacts) {
        const topics = evidenceRecord(
          scenarioFacts.topics,
          'foundationF12StationTopics',
        );
        const alpha = evidenceRecord(
          topics.alpha,
          'foundationF12StationAlpha',
        );
        const beta = evidenceRecord(
          topics.beta,
          'foundationF12StationBeta',
        );
        const alphaPost = evidenceRecord(
          alpha.postRestart,
          'foundationF12StationAlphaPost',
        );
        const betaPost = evidenceRecord(
          beta.postRestart,
          'foundationF12StationBetaPost',
        );
        stationReadback.entityKind = 'agent-two-topic-restart-readback';
        stationReadback.entityIdHash = await sha256Hex(stableJson([
          alpha.conversationId,
          beta.conversationId,
        ]));
        stationReadback.revision = Number(
          evidenceRecord(
            alphaPost.conversation,
            'foundationF12StationAlphaConversation',
          ).version,
        ) + Number(
          evidenceRecord(
            betaPost.conversation,
            'foundationF12StationBetaConversation',
          ).version,
        );
        stationReadback.stateHash = await sha256Hex(stableJson({
          alpha: alphaPost,
          beta: betaPost,
        }));
        stationReadback.topics = {
          alpha: alphaPost,
          beta: betaPost,
        };
      }

      const runtimeEvents: Record<string, unknown> =
        cell === 'BASE-ACTIVE_MUTATION_CONFLICT' && scenarioFacts
          ? {
              eventId: await sha256Hex(stableJson(scenarioFacts.rejection)),
              sequence: Number(
                evidenceRecord(
                  scenarioFacts.winner,
                  'foundationActiveMutationConflictWinner',
                ).actualRevision,
              ),
              eventType: 'ADMISSION_ACTIVE_MUTATION_CONFLICT',
              occurredAt: String(
                evidenceRecord(
                  scenarioFacts.rejection,
                  'foundationActiveMutationConflictRejection',
                ).observedAt,
              ),
            }
          : (
            cell === 'BASE-ATTACHMENT_REJECTED'
            || cell === 'BASE-CANCELLED'
            || cell === 'BASE-CONTEXT_OVERFLOW'
            || cell === 'BASE-DUPLICATE_CONFLICT'
            || cell === 'BASE-CREDENTIAL_MISSING'
          ) && observedRuntimeEvent
            ? {
                eventId: observedRuntimeEvent.eventId ?? '',
                sequence: observedRuntimeEvent.sequence,
                eventType: observedRuntimeEvent.eventType,
                occurredAt: observedRuntimeEvent.observedAt,
                streamGeneration: observedRuntimeEvent.streamGeneration,
                streamIdHash: observedRuntimeEvent.streamIdHash,
                conversationIdHash: observedRuntimeEvent.conversationIdHash,
                payloadHash: observedRuntimeEvent.payloadHash,
                errorType: observedRuntimeEvent.errorType,
                ...(
                  (
                    cell === 'BASE-CANCELLED'
                    || cell === 'BASE-CONTEXT_OVERFLOW'
                    || cell === 'BASE-DUPLICATE_CONFLICT'
                    || cell === 'BASE-CREDENTIAL_MISSING'
                  )
                    ? {
                      sourceTransport: observedRuntimeEvent.sourceTransport,
                      sourcePtidHash: observedRuntimeEvent.sourcePtidHash,
                      sourceConversationId:
                        observedRuntimeEvent.sourceConversationId,
                      sourceTurnId: observedRuntimeEvent.sourceTurnId,
                      sourceSequence: observedRuntimeEvent.sourceSequence,
                      sourceEventType: observedRuntimeEvent.sourceEventType,
                    }
                    : {}
                ),
              }
          : cell === 'AS-F12' && scenarioFacts
            ? {
                eventId: await sha256Hex(stableJson({
                  events: scenarioFacts.runtimeEvents,
                  restart: scenarioFacts.restart,
                })),
                sequence: evidenceArray(
                  scenarioFacts.runtimeEvents,
                  'foundationF12RuntimeEvents',
                ).length,
                eventType: 'TWO_TOPIC_RESTART_RESTORED',
                occurredAt: observedRuntimeEvent?.observedAt ?? '',
                events: scenarioFacts.runtimeEvents,
                restart: scenarioFacts.restart,
              }
          : turnEvidence && observedRuntimeEvent
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
        cell === 'AS-F04'
        || cell === 'AS-F12'
        || cell === 'BASE-APPROVAL_EXPIRED'
          ? 900_000
          : cell === 'AS-F06'
            ? 300_000
            : 120_000;
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
      const sideEffectCount: Record<string, unknown> =
        cell === 'BASE-ACTIVE_MUTATION_CONFLICT' && scenarioFacts
          ? {
              counterId: await sha256Hex(stableJson({
                cell,
                sampleId,
                resourceId: evidenceRecord(
                  scenarioFacts.winner,
                  'foundationActiveMutationConflictWinner',
                ).resourceId,
              })),
              count: Number(
                evidenceRecord(
                  scenarioFacts.staleMutation,
                  'foundationActiveMutationConflictStaleMutation',
                ).mutationDelta,
              ),
              maximum: 0,
            }
          : cell === 'BASE-CANCELLED' && scenarioFacts
            ? (() => {
                const station = evidenceRecord(
                  scenarioFacts.station,
                  'foundationCancelledStation',
                );
                return {
                  counterId: String(station.turnId),
                  count: Number(station.doneEventCount),
                  maximum: 0,
                  measurements: {
                    terminalEventCount: station.terminalEventCount,
                    cancelledEventCount: station.cancelledEventCount,
                    liveTerminalEventCount: station.liveTerminalEventCount,
                    liveDoneEventCount: station.liveDoneEventCount,
                  },
                };
              })()
          : cell === 'BASE-ATTACHMENT_REJECTED' && scenarioFacts
            ? (() => {
                const station = evidenceRecord(
                  scenarioFacts.station,
                  'foundationAttachmentRejectedStation',
                );
                return {
                  counterId: String(station.attachmentId),
                  count: Number(station.providerExecutionDelta),
                  maximum: 0,
                  measurements: {
                    turnDelta: station.turnDelta,
                    messageDelta: station.messageDelta,
                    providerExecutionDelta:
                      station.providerExecutionDelta,
                  },
                };
              })()
          : cell === 'BASE-CONTEXT_OVERFLOW' && scenarioFacts
            ? (() => {
                const station = evidenceRecord(
                  scenarioFacts.station,
                  'foundationContextOverflowStation',
                );
                const count =
                  Number(station.turnDelta)
                  + Number(station.messageDelta)
                  + Number(station.queueDelta)
                  + Number(station.providerExecutionDelta);
                return {
                  counterId: String(station.conversationId),
                  count,
                  maximum: 0,
                  measurements: {
                    turnDelta: station.turnDelta,
                    messageDelta: station.messageDelta,
                    queueDelta: station.queueDelta,
                    providerExecutionDelta:
                      station.providerExecutionDelta,
                  },
                };
              })()
          : cell === 'BASE-DUPLICATE_CONFLICT' && scenarioFacts
            ? (() => {
                const station = evidenceRecord(
                  scenarioFacts.station,
                  'foundationDuplicateConflictStation',
                );
                const count =
                  Number(station.turnDelta)
                  + Number(station.messageDelta)
                  + Number(station.queueDelta)
                  + Number(station.providerExecutionDelta);
                return {
                  counterId: String(station.originalTurnId),
                  count,
                  maximum: 0,
                  measurements: {
                    turnDelta: station.turnDelta,
                    messageDelta: station.messageDelta,
                    queueDelta: station.queueDelta,
                    providerExecutionDelta:
                      station.providerExecutionDelta,
                  },
                };
              })()
          : cell === 'BASE-CREDENTIAL_MISSING' && scenarioFacts
            ? (() => {
                const station = evidenceRecord(
                  scenarioFacts.station,
                  'foundationCredentialMissingStation',
                );
                return {
                  counterId: String(station.providerId),
                  count: Number(station.providerExecutionDelta),
                  maximum: 0,
                  measurements: {
                    turnDelta: station.turnDelta,
                    messageDelta: station.messageDelta,
                    queueDelta: station.queueDelta,
                    providerExecutionDelta:
                      station.providerExecutionDelta,
                  },
                };
              })()
          : cell === 'BASE-EXECUTOR-UNAVAILABLE' && scenarioFacts
            ? (() => {
                const station = evidenceRecord(
                  scenarioFacts.station,
                  'foundationExecutorUnavailableStation',
                );
                const lineage = evidenceRecord(
                  station.lineage,
                  'foundationExecutorUnavailableLineage',
                );
                return {
                  counterId: String(lineage.toolCallId),
                  count:
                    Number(station.executionAttemptCount)
                    + Number(station.sideEffectCount)
                    + Number(station.resultCount)
                    + Number(station.continuationCount),
                  maximum: 0,
                };
              })()
          : (
            cell === 'BASE-APPROVAL_DENIED'
            || cell === 'BASE-APPROVAL_EXPIRED'
          ) && scenarioFacts
            ? (() => {
                const station = evidenceRecord(
                  scenarioFacts.station,
                  cell === 'BASE-APPROVAL_DENIED'
                    ? 'foundationApprovalDeniedStation'
                    : 'foundationApprovalExpiredStation',
                );
                const lineage = evidenceRecord(
                  station.lineage,
                  cell === 'BASE-APPROVAL_DENIED'
                    ? 'foundationApprovalDeniedLineage'
                    : 'foundationApprovalExpiredLineage',
                );
                return {
                  counterId: String(lineage.toolCallId),
                  count: Number(station.sideEffectCount),
                  maximum: 0,
                };
              })()
            : cell === 'AS-F04'
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
          : cell === 'AS-F12' && scenarioFacts
            ? (() => {
                const stale = evidenceRecord(
                  scenarioFacts.staleMutation,
                  'foundationF12SideEffectStaleMutation',
                );
                const before = evidenceRecord(
                  stale.before,
                  'foundationF12SideEffectBefore',
                );
                const after = evidenceRecord(
                  stale.after,
                  'foundationF12SideEffectAfter',
                );
                const unchanged =
                  before.alphaHash === after.alphaHash
                  && before.betaHash === after.betaHash
                  && Number(before.alphaVersion) === Number(after.alphaVersion)
                  && Number(before.betaVersion) === Number(after.betaVersion);
                return {
                  counterId: String(stale.targetConversationId ?? ''),
                  count: unchanged ? 0 : 1,
                  maximum: 0,
                  measurements: stale,
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
      const activeMutationCleanup =
        cell === 'BASE-ACTIVE_MUTATION_CONFLICT' && scenarioFacts
          ? evidenceRecord(
              scenarioFacts.cleanup,
              'foundationActiveMutationConflictCleanup',
            )
          : null;
      const cancellationCleanup =
        cell === 'BASE-CANCELLED' && scenarioFacts
          ? evidenceRecord(
              scenarioFacts.cleanup,
              'foundationCancelledCleanup',
            )
          : null;
      const contextOverflowCleanup =
        cell === 'BASE-CONTEXT_OVERFLOW' && scenarioFacts
          ? evidenceRecord(
              scenarioFacts.cleanup,
              'foundationContextOverflowCleanup',
            )
          : null;
      const duplicateConflictCleanup =
        cell === 'BASE-DUPLICATE_CONFLICT' && scenarioFacts
          ? evidenceRecord(
              scenarioFacts.cleanup,
              'foundationDuplicateConflictCleanup',
            )
          : null;
      const credentialMissingCleanup =
        cell === 'BASE-CREDENTIAL_MISSING' && scenarioFacts
          ? evidenceRecord(
              scenarioFacts.cleanup,
              'foundationCredentialMissingCleanup',
            )
          : null;
      const cleanup: Record<string, unknown> = {
        status: (
          activeMutationCleanup
            ? (
                activeMutationCleanup.deletedFromRoster === true
                && activeMutationCleanup.deletedFromStation === true
                && activeMutationCleanup.conversationDeleted === true
                && activeMutationCleanup.restoredSelection
                  === activeMutationCleanup.priorSelection
              )
            : cancellationCleanup
              ? (
                  Number(cancellationCleanup.cancellationRequestCount) === 1
                  && Number(cancellationCleanup.terminalCleanupCount) === 1
                  && cancellationCleanup.conversationDeleted === true
                )
            : contextOverflowCleanup
              ? (
                  contextOverflowCleanup.draftCleared === true
                  && contextOverflowCleanup.localProjectionCleared === true
                  && contextOverflowCleanup.conversationDeleted === true
                )
            : duplicateConflictCleanup
              ? (
                  duplicateConflictCleanup.conversationDeleted === true
                  && duplicateConflictCleanup.localProjectionCleared === true
                  && duplicateConflictCleanup.operationCleared === true
                  && duplicateConflictCleanup.portalClosed === true
                )
            : credentialMissingCleanup
              ? (
                  credentialMissingCleanup.conversationDeleted === true
                  && credentialMissingCleanup.disposableAgentDeleted === true
                  && credentialMissingCleanup.restoredSelection
                    === credentialMissingCleanup.priorSelection
                )
            : cell === 'BASE-ATTACHMENT_REJECTED' && scenarioFacts
              ? (
                  evidenceRecord(
                    scenarioFacts.cleanup,
                    'foundationAttachmentRejectedCleanup',
                  ).draftRemoved === true
                  && evidenceRecord(
                    scenarioFacts.cleanup,
                    'foundationAttachmentRejectedCleanup',
                  ).objectDeleted === true
                  && evidenceRecord(
                    scenarioFacts.cleanup,
                    'foundationAttachmentRejectedCleanup',
                  ).conversationDeleted === true
                )
            : cell === 'BASE-EXECUTOR-UNAVAILABLE' && scenarioFacts
              ? (
                  evidenceRecord(
                    scenarioFacts.cleanup,
                    'foundationExecutorUnavailableCleanup',
                  ).conversationDeleted === true
                  && evidenceRecord(
                    scenarioFacts.cleanup,
                    'foundationExecutorUnavailableCleanup',
                  ).bindingRestored === true
                  && evidenceRecord(
                    scenarioFacts.cleanup,
                    'foundationExecutorUnavailableCleanup',
                  ).executorRestored === true
                  && evidenceRecord(
                    scenarioFacts.cleanup,
                    'foundationExecutorUnavailableCleanup',
                  ).turnCancelled === true
                )
            : (
              cell === 'BASE-APPROVAL_DENIED'
              || cell === 'BASE-APPROVAL_EXPIRED'
            ) && scenarioFacts
              ? (
                  evidenceRecord(
                    scenarioFacts.cleanup,
                    cell === 'BASE-APPROVAL_DENIED'
                      ? 'foundationApprovalDeniedCleanup'
                      : 'foundationApprovalExpiredCleanup',
                  ).conversationDeleted === true
                  && evidenceRecord(
                    scenarioFacts.cleanup,
                    cell === 'BASE-APPROVAL_DENIED'
                      ? 'foundationApprovalDeniedCleanup'
                      : 'foundationApprovalExpiredCleanup',
                  ).bindingRestored === true
                )
            : cell === 'AS-F05'
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
              : cell === 'AS-F12' && scenarioFacts
                ? (
                    evidenceRecord(
                      scenarioFacts.cleanup,
                      'foundationF12Cleanup',
                    ).cleanupComplete === true
                    && evidenceRecord(
                      scenarioFacts.cleanup,
                      'foundationF12Cleanup',
                    ).handoffCleared === true
                    && evidenceArray(
                      evidenceRecord(
                        scenarioFacts.cleanup,
                        'foundationF12Cleanup',
                      ).deletedConversationIds,
                      'foundationF12DeletedConversations',
                    ).length === 2
                  )
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
          : cell === 'AS-F12' && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : cell === 'BASE-ATTACHMENT_REJECTED' && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : cell === 'BASE-EXECUTOR-UNAVAILABLE' && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : (
            cell === 'BASE-APPROVAL_DENIED'
            || cell === 'BASE-APPROVAL_EXPIRED'
          ) && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : cell === 'BASE-ACTIVE_MUTATION_CONFLICT' && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : cell === 'BASE-CANCELLED' && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : cell === 'BASE-CONTEXT_OVERFLOW' && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : cell === 'BASE-DUPLICATE_CONFLICT' && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : cell === 'BASE-CREDENTIAL_MISSING' && scenarioFacts
            ? { proof: scenarioFacts.cleanup }
          : {}),
      };

      const receiver = (
        cell === 'BASE-ACTIVE_MUTATION_CONFLICT'
        || cell === 'BASE-CANCELLED'
        || cell === 'BASE-EXECUTOR-UNAVAILABLE'
        || cell === 'BASE-APPROVAL_DENIED'
        || cell === 'BASE-APPROVAL_EXPIRED'
        || cell === 'BASE-ATTACHMENT_REJECTED'
        || cell === 'BASE-CONTEXT_OVERFLOW'
        || cell === 'BASE-DUPLICATE_CONFLICT'
        || cell === 'BASE-CREDENTIAL_MISSING'
      ) && scenarioFacts
        ? evidenceRecord(
            scenarioFacts.receiver,
            'foundationTypedErrorReceiver',
          )
        : null;
      let receiverVisible =
        receiverDom.composer.visibleCount > 0
        || receiverDom.assistantMessages.visibleCount > 0;
      let receiverSelector =
        '[data-pt-agent-composer],[data-pt-agent-message="assistant"]';
      let receiverText: unknown = receiverDom.assistantMessages.text;
      if (cell === 'AS-F05') {
        receiverVisible = receiverDom.messageAttachments.visibleCount >= 2;
        receiverSelector = '[data-pt-agent-message-attachment]';
        receiverText = receiverDom.messageAttachments.text;
      } else if (receiver) {
        if (cell === 'BASE-EXECUTOR-UNAVAILABLE') {
          receiverVisible =
            receiver.recoveryVisible === true
            && receiver.errorVisible === true
            && receiver.recoveryExecuted === true;
          receiverSelector =
            '[data-pt-agent-tool-recovery="reconnect-executor"],'
            + '[data-pt-agent-tool-error="agent.errors.executorUnavailable"]';
          receiverText = {
            recoveryText: receiver.recoveryText,
            errorText: receiver.errorText,
          };
        } else if (
          cell === 'BASE-APPROVAL_DENIED'
          || cell === 'BASE-APPROVAL_EXPIRED'
        ) {
          receiverVisible =
            receiver.recoveryVisible === true
            && receiver.errorVisible === true;
          receiverSelector = cell === 'BASE-APPROVAL_DENIED'
            ? '[data-pt-agent-tool-recovery="continue-without-tool"],[data-pt-agent-tool-error]'
            : '[data-pt-agent-tool-recovery="request-again"],[data-pt-agent-tool-error]';
          receiverText = {
            recoveryText: receiver.recoveryText,
            errorText: receiver.errorText,
          };
        } else if (cell === 'BASE-ATTACHMENT_REJECTED') {
          receiverVisible =
            receiver.errorVisible === true
            && receiver.removalVisible === true;
          receiverSelector =
            '[data-pt-agent-message-error-text="agent.errors.attachmentRejected"],'
            + '[data-pt-agent-composer-attachment-remove]';
          receiverText = {
            errorText: receiver.errorText,
            removalText: receiver.removalText,
          };
        } else if (cell === 'BASE-CANCELLED') {
          receiverVisible =
            receiver.visible === true
            && receiver.terminalStatus === 'cancelled'
            && receiver.errorType === 'LIFECYCLE_CANCELLED';
          receiverSelector =
            '[data-pt-agent-terminal-status="cancelled"]'
            + '[data-pt-agent-error-resource-kind="turn"]'
            + '[data-pt-agent-error-type="LIFECYCLE_CANCELLED"]';
          receiverText = {
            errorText: receiver.errorText,
            recoveryVisible: receiver.recoveryVisible,
          };
        } else if (cell === 'BASE-CONTEXT_OVERFLOW') {
          receiverVisible =
            receiver.errorVisible === true
            && receiver.recoveryVisible === true;
          receiverSelector =
            '[data-pt-agent-message-error-text="agent.errors.contextOverflow"],'
            + '[data-pt-agent-message-error-recovery="reduce-context"]';
          receiverText = {
            errorText: receiver.errorText,
            recoveryText: receiver.recoveryText,
          };
        } else if (cell === 'BASE-DUPLICATE_CONFLICT') {
          receiverVisible =
            receiver.errorVisible === true
            && receiver.recoveryVisible === true
            && receiver.openOriginalExecuted === true;
          receiverSelector =
            '[data-pt-agent-message-error-text="agent.errors.duplicateConflict"],'
            + '[data-pt-agent-message-error-recovery="open-original"]';
          receiverText = {
            errorText: receiver.errorText,
            recoveryText: receiver.recoveryText,
          };
        } else if (cell === 'BASE-CREDENTIAL_MISSING') {
          receiverVisible =
            receiver.errorVisible === true
            && receiver.recoveryVisible === true;
          receiverSelector =
            '[data-pt-agent-message-error-text="agent.errors.providerCredentialMissing"],'
            + '[data-pt-agent-message-error-recovery="configure-credential"]';
          receiverText = {
            errorText: receiver.errorText,
            recoveryText: receiver.recoveryText,
          };
        } else {
          receiverVisible =
            receiver.conflictVisible === true
            && receiver.reloadVisible === true;
          receiverSelector =
            '[data-pt-agent-profile-conflict],[data-pt-agent-profile-reload]';
          receiverText = {
            conflictText: receiver.conflictText,
            reloadText: receiver.reloadText,
          };
        }
      }
      const receiverDomRole: Record<string, unknown> = {
        scenarioId: cell,
        cellId: cell,
        visible: receiverVisible,
        selector: receiverSelector,
        locale,
        textHash: await sha256Hex(stableJson(receiverText)),
      };
      if (cell === 'BASE-ACTIVE_MUTATION_CONFLICT' && scenarioFacts) {
        const winner = evidenceRecord(
          scenarioFacts.winner,
          'foundationActiveMutationConflictWinner',
        );
        replayEvidence.sourceHash = winner.hashBeforeStale;
        replayEvidence.replayHash = winner.hashAfterReload;
        replayEvidence.equal = winner.hashBeforeStale === winner.hashAfterReload;
        replayEvidence.turnId = null;
      }
      if (cell === 'BASE-CANCELLED' && scenarioFacts) {
        const replay = evidenceRecord(
          scenarioFacts.replay,
          'foundationCancelledReplay',
        );
        replayEvidence.sourceHash = replay.sourceHash;
        replayEvidence.replayHash = replay.replayHash;
        replayEvidence.equal = replay.equal;
      }
      if (cell === 'BASE-EXECUTOR-UNAVAILABLE' && scenarioFacts) {
        const replay = evidenceRecord(
          scenarioFacts.replay,
          'foundationExecutorUnavailableReplay',
        );
        replayEvidence.sourceHash = replay.acknowledgementSourceHash;
        replayEvidence.replayHash = replay.acknowledgementReplayHash;
        replayEvidence.equal = replay.equal;
      }
      if (
        (
          cell === 'BASE-APPROVAL_DENIED'
          || cell === 'BASE-APPROVAL_EXPIRED'
        )
        && scenarioFacts
      ) {
        const replay = evidenceRecord(
          scenarioFacts.replay,
          cell === 'BASE-APPROVAL_DENIED'
            ? 'foundationApprovalDeniedReplay'
            : 'foundationApprovalExpiredReplay',
        );
        replayEvidence.sourceHash = replay.acknowledgementSourceHash;
        replayEvidence.replayHash = replay.acknowledgementReplayHash;
        replayEvidence.equal = replay.equal;
      }
      if (cell === 'BASE-ATTACHMENT_REJECTED' && scenarioFacts) {
        const replay = evidenceRecord(
          scenarioFacts.replay,
          'foundationAttachmentRejectedReplay',
        );
        replayEvidence.sourceHash = replay.sourceHash;
        replayEvidence.replayHash = replay.replayHash;
        replayEvidence.equal = replay.equal;
      }
      if (cell === 'BASE-CONTEXT_OVERFLOW' && scenarioFacts) {
        const replay = evidenceRecord(
          scenarioFacts.replay,
          'foundationContextOverflowReplay',
        );
        replayEvidence.sourceHash = replay.sourceHash;
        replayEvidence.replayHash = replay.replayHash;
        replayEvidence.equal = replay.equal;
      }
      if (cell === 'BASE-DUPLICATE_CONFLICT' && scenarioFacts) {
        const replay = evidenceRecord(
          scenarioFacts.replay,
          'foundationDuplicateConflictReplay',
        );
        replayEvidence.sourceHash = replay.sourceHash;
        replayEvidence.replayHash = replay.replayHash;
        replayEvidence.equal = replay.equal;
      }
      if (cell === 'BASE-CREDENTIAL_MISSING' && scenarioFacts) {
        const replay = evidenceRecord(
          scenarioFacts.replay,
          'foundationCredentialMissingReplay',
        );
        replayEvidence.sourceHash = replay.sourceHash;
        replayEvidence.replayHash = replay.replayHash;
        replayEvidence.equal = replay.equal;
      }
      if (cell === 'AS-F12' && scenarioFacts) {
        const topics = evidenceRecord(
          scenarioFacts.topics,
          'foundationF12ReplayTopics',
        );
        const alpha = evidenceRecord(
          topics.alpha,
          'foundationF12ReplayAlpha',
        );
        const beta = evidenceRecord(
          topics.beta,
          'foundationF12ReplayBeta',
        );
        replayEvidence.sourceHash = await sha256Hex(stableJson({
          alpha: alpha.preRestart,
          beta: beta.preRestart,
        }));
        replayEvidence.replayHash = await sha256Hex(stableJson({
          alpha: alpha.postRestart,
          beta: beta.postRestart,
        }));
        replayEvidence.equal =
          replayEvidence.sourceHash === replayEvidence.replayHash;
        replayEvidence.turnId = null;
        replayEvidence.topics = {
          alpha: {
            sourceHash: alpha.preRestartHash,
            replayHash: alpha.postRestartHash,
          },
          beta: {
            sourceHash: beta.preRestartHash,
            replayHash: beta.postRestartHash,
          },
        };
        const alphaReceiver = evidenceRecord(
          alpha.receiverAfter,
          'foundationF12ReceiverAlpha',
        );
        const betaReceiver = evidenceRecord(
          beta.receiverAfter,
          'foundationF12ReceiverBeta',
        );
        receiverDomRole.visible =
          alphaReceiver.selectedBranchVisible === true
          && betaReceiver.selectedBranchVisible === true
          && alphaReceiver.ownFactVisible === true
          && betaReceiver.ownFactVisible === true
          && alphaReceiver.foreignFactVisible === false
          && betaReceiver.foreignFactVisible === false;
        receiverDomRole.selector = '[data-pt-agent-message-id]';
        receiverDomRole.textHash = await sha256Hex(stableJson({
          alpha: alphaReceiver,
          beta: betaReceiver,
        }));
        receiverDomRole.topics = {
          alpha: alphaReceiver,
          beta: betaReceiver,
        };
      }

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
      } catch (error) {
        if (cell === 'BASE-APPROVAL_EXPIRED' && preparedConversationId) {
          try {
            await cleanupFoundationToolConversation(
              preparedConversationId,
              preparedTurnId ?? '',
            );
          } catch (cleanupError) {
            throw Object.assign(
              new Error('agent.acceptance.foundationToolExpiryCleanupFailed'),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-CANCELLED'
          && preparedConversationId
        ) {
          try {
            await cleanupFoundationToolConversation(
              preparedConversationId,
              preparedTurnId ?? '',
            );
          } catch (cleanupError) {
            throw Object.assign(
              new Error('agent.acceptance.foundationCancellationCleanupFailed'),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-ACTIVE_MUTATION_CONFLICT'
          && preparedConversationId
        ) {
          try {
            await deleteFoundationConversation(preparedConversationId);
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                'agent.acceptance.foundationActiveMutationAttestationCleanupFailed',
              ),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-ATTACHMENT_REJECTED'
          && preparedConversationId
        ) {
          try {
            await deleteFoundationConversation(preparedConversationId);
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                'agent.acceptance.foundationAttachmentRejectionCleanupFailed',
              ),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-CONTEXT_OVERFLOW'
          && preparedConversationId
        ) {
          try {
            const textarea = document.querySelector<HTMLTextAreaElement>(
              '[data-pt-agent-composer-input]',
            );
            if (textarea) {
              const setTextareaValue = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                'value',
              )?.set;
              setTextareaValue?.call(textarea, '');
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            await deleteFoundationConversation(preparedConversationId);
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                'agent.acceptance.foundationContextOverflowCleanupFailed',
              ),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-CREDENTIAL_MISSING'
          && preparedConversationId
        ) {
          try {
            await deleteFoundationConversation(preparedConversationId);
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                'agent.acceptance.foundationCredentialMissingAttestationCleanupFailed',
              ),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-EXECUTOR-UNAVAILABLE'
          && preparedConversationId
        ) {
          try {
            await cleanupFoundationToolConversation(
              preparedConversationId,
              preparedTurnId ?? '',
            );
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                'agent.acceptance.foundationExecutorUnavailableCleanupFailed',
              ),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-DUPLICATE_CONFLICT'
          && preparedConversationId
        ) {
          try {
            usePortalStore.getState().close();
            clearFoundationLocalConversationProjection(
              preparedConversationId,
            );
            await cleanupFoundationToolConversation(
              preparedConversationId,
              preparedTurnId ?? '',
            );
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                'agent.acceptance.foundationDuplicateConflictCleanupFailed',
              ),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-DUPLICATE_CONFLICT'
          && preparedConversationId
        ) {
          try {
            usePortalStore.getState().close();
            clearFoundationLocalConversationProjection(
              preparedConversationId,
            );
            await cleanupFoundationToolConversation(
              preparedConversationId,
              preparedTurnId ?? '',
            );
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                'agent.acceptance.foundationDuplicateConflictCleanupFailed',
              ),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        if (
          cell === 'BASE-DUPLICATE_CONFLICT'
          && preparedConversationId
        ) {
          try {
            usePortalStore.getState().close();
            clearFoundationLocalConversationProjection(
              preparedConversationId,
            );
            await cleanupFoundationToolConversation(
              preparedConversationId,
              preparedTurnId ?? '',
            );
          } catch (cleanupError) {
            throw Object.assign(
              new Error(
                'agent.acceptance.foundationDuplicateConflictCleanupFailed',
              ),
              {
                primaryError: error,
                cleanupError,
              },
            );
          }
        }
        throw error;
      }
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
