import type { RuntimeDescriptor } from '../kernel/runtime';
import { EVENT, eventBus } from '../kernel/events';
import type { AgentTurnStreamEventPayload } from '../kernel/events/types';
import {
  classifyAgentTurnTerminalEvent,
  streamAgentTurnReplay,
  type AgentTurnSourceDelivery,
  type StreamEvent,
} from '../services/desktop_api';
import { createDesktopClientStorageRuntime } from '../storage/desktopClientStorage';
import {
  type ActiveAgentTurnRecovery,
  type AgentTurnRecoveryPhase,
  useAgentTurnRecoveryStore,
} from '../store/agentTurnRecovery';
import {
  type RecoveredTurnTerminal,
  useChatStore,
} from '../store/chat';
import { useSessionStore } from '../store/session';
import { log } from '../utils/logger';

const RECOVERY_STORAGE_KEY = 'agent-turn-recovery';
const RECOVERY_RECONCILE_INTERVAL_MS = 15_000;
const RECOVERY_PHASES = new Set<AgentTurnRecoveryPhase>([
  'CONNECTED',
  'CONNECTION_LOST',
  'RECONNECTING',
  'REPLAYING',
  'RECONCILING',
  'RECOVERY_FAILED',
]);
const AUTHORITATIVE_SNAPSHOT_STATUSES = new Set([
  'running',
  'waiting_local_tool',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

// #region debug-point A-D:native-replay-delivery
function reportNativeReplayDebug(
  hypothesisId: string,
  location: string,
  msg: string,
  data: Record<string, unknown>,
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'native-replay-timeout',
      runId: 'post-fix',
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

interface RecoverySubscription {
  turnId: string;
  streamGeneration: number;
  recoveryEpoch: number;
  controller: AbortController;
  eventChain: Promise<void>;
}

interface AuthoritativeTurnSnapshot {
  event: StreamEvent;
  status: string;
  terminal: RecoveredTurnTerminal | null;
  sourceDelivery: AgentTurnSourceDelivery;
}

interface SourceBoundReplayDelivery extends AgentTurnStreamEventPayload {
  sourceDelivery: AgentTurnSourceDelivery;
  deliveryOnly: true;
}

export interface AgentTurnSnapshotReloadResult {
  source: 'station-snapshot-reconcile';
  actorId: string;
  conversationId: string;
  turnId: string;
  streamId: string;
  streamGeneration: number;
  status: string;
  sequence: number;
  terminal: boolean;
  terminalStatus: RecoveredTurnTerminal['status'] | null;
  sourceDelivery: AgentTurnSourceDelivery;
}

let installed = false;
let actorId: string | null = null;
let actorBootstrapSequence = 0;
let unsubscribeStream: (() => void) | null = null;
let unsubscribeRecoveryRetry: (() => void) | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let persistence:
  | ReturnType<typeof createDesktopClientStorageRuntime>['repositories']['runtimeProjection']
  | null = null;
let persistenceChain: Promise<void> = Promise.resolve();
const recoverySubscriptions = new Map<string, RecoverySubscription>();

function activeRecords(): Record<string, ActiveAgentTurnRecovery> {
  return useAgentTurnRecoveryStore.getState().active;
}

export function parsePersistedAgentTurnRecoveries(
  expectedActorId: string,
  value: unknown,
): Record<string, ActiveAgentTurnRecovery> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const records: Record<string, ActiveAgentTurnRecovery> = {};
  for (const [mapKey, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Partial<ActiveAgentTurnRecovery>;
    if (
      record.actorId !== expectedActorId
      || record.conversationId !== mapKey
      || typeof record.agentId !== 'string'
      || typeof record.turnId !== 'string'
      || typeof record.streamId !== 'string'
      || !Number.isSafeInteger(record.streamGeneration)
      || Number(record.streamGeneration) <= 0
      || !Number.isSafeInteger(record.cursor)
      || Number(record.cursor) < 0
      || typeof record.phase !== 'string'
      || !RECOVERY_PHASES.has(record.phase as AgentTurnRecoveryPhase)
      || !Number.isSafeInteger(record.startedAt)
      || !Number.isSafeInteger(record.updatedAt)
      || !Number.isSafeInteger(record.recoveryEpoch)
    ) {
      continue;
    }
    records[mapKey] = record as ActiveAgentTurnRecovery;
  }
  return records;
}

function persistActiveRecords(): Promise<void> {
  const repository = persistence;
  if (!repository || !actorId) return persistenceChain;
  const snapshot = { ...activeRecords() };
  persistenceChain = persistenceChain
    .then(async () => {
      await repository.write(RECOVERY_STORAGE_KEY, snapshot);
    })
    .catch((error) => {
      log.error('chatRuntime', 'failed to persist active Agent turns', {
        error: String(error),
      });
    });
  return persistenceChain;
}

export function flushAgentTurnRecoveryPersistence(): Promise<void> {
  return persistActiveRecords();
}

function streamEvent(
  record: ActiveAgentTurnRecovery,
  event: string,
  data: Record<string, unknown> = {},
): StreamEvent {
  return {
    event,
    data: {
      ...data,
      turnId: record.turnId,
      conversationId: record.conversationId,
      seq: data.seq ?? record.cursor,
      streamGeneration: record.streamGeneration,
    },
  };
}

function transition(
  record: ActiveAgentTurnRecovery,
  phase: AgentTurnRecoveryPhase,
  event: string,
  data: Record<string, unknown> = {},
): ActiveAgentTurnRecovery | null {
  const next = useAgentTurnRecoveryStore
    .getState()
    .setPhase(record.conversationId, record.turnId, phase, data.error as string | undefined);
  if (!next) return null;
  useChatStore
    .getState()
    .applyRecoveredTurnEvent(
      next.conversationId,
      next.agentId,
      next.turnId,
      streamEvent(next, event, data),
    );
  persistActiveRecords();
  return next;
}

function currentRecord(
  conversationId: string,
  turnId: string,
  streamGeneration: number,
  recoveryEpoch?: number,
): ActiveAgentTurnRecovery | null {
  const current = activeRecords()[conversationId];
  if (
    current?.turnId !== turnId
    || current.streamGeneration !== streamGeneration
    || (recoveryEpoch !== undefined && current.recoveryEpoch !== recoveryEpoch)
  ) {
    return null;
  }
  return current;
}

function terminalFromEvent(event: StreamEvent): RecoveredTurnTerminal | null {
  const status = classifyAgentTurnTerminalEvent(event);
  if (!status || status === 'queued') return null;
  const snapshotContent =
    event.event === 'snapshot' && typeof event.data.text === 'string'
      ? event.data.text
      : undefined;
  return {
    status,
    reason: String(
      event.data.terminal_reason
      || event.data.error
      || '',
    ).trim() || undefined,
    ...(snapshotContent !== undefined ? { content: snapshotContent } : {}),
  };
}

function parseAuthoritativeTurnSnapshot(
  record: ActiveAgentTurnRecovery,
  event: StreamEvent,
): AuthoritativeTurnSnapshot {
  const turnId = String(event.data.turnId || event.data.turn_id || '').trim();
  const conversationId = String(
    event.data.conversationId || event.data.conversation_id || '',
  ).trim();
  const status = String(event.data.status || '').trim().toLowerCase();
  const sequence = Number(event.data.seq ?? event.data.sequence);
  const sourceDelivery = event.sourceDelivery;
  if (
    event.event !== 'snapshot'
    || event.ptid !== record.actorId
    || turnId !== record.turnId
    || conversationId !== record.conversationId
    || !AUTHORITATIVE_SNAPSHOT_STATUSES.has(status)
    || !Number.isSafeInteger(sequence)
    || sequence < record.cursor
    || !sourceDelivery
    || sourceDelivery.transport !== 'station-sse'
    || sourceDelivery.ptid !== record.actorId
    || sourceDelivery.conversationId !== record.conversationId
    || sourceDelivery.turnId !== record.turnId
    || sourceDelivery.sequence !== sequence
    || sourceDelivery.rawPayload.eventType !== event.event
  ) {
    throw new Error('chat.agentTurnRecovery.snapshotInvalid');
  }
  return {
    event: {
      ...event,
      data: {
        ...event.data,
        turnId,
        conversationId,
        seq: sequence,
      },
    },
    status,
    terminal: terminalFromEvent(event),
    sourceDelivery,
  };
}

function loadAuthoritativeTurnSnapshot(
  record: ActiveAgentTurnRecovery,
): Promise<AuthoritativeTurnSnapshot> {
  // #region debug-point A:snapshot-reload-start
  reportNativeReplayDebug('A', 'chatRuntime.ts:loadAuthoritativeTurnSnapshot', 'snapshot reload started', {
    cursor: record.cursor,
    streamGeneration: record.streamGeneration,
  });
  // #endregion
  return new Promise((resolve, reject) => {
    let settled = false;
    let abortRequested = false;
    let controller: AbortController | null = null;
    const finish = (
      result: AuthoritativeTurnSnapshot | null,
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      if (controller) controller.abort();
      else abortRequested = true;
      // #region debug-point A:reload-finished
      reportNativeReplayDebug('A', 'chatRuntime.ts:loadAuthoritativeTurnSnapshot.finish', 'snapshot reload finished', {
        outcome: error ? 'error' : 'snapshot',
        error: error?.message ?? null,
        eventType: result?.event.event ?? null,
        sequence: result?.sourceDelivery.sequence ?? null,
      });
      // #endregion
      if (error) reject(error);
      else if (result) resolve(result);
    };
    controller = streamAgentTurnReplay(
      {
        conversation_id: record.conversationId,
        turn_id: record.turnId,
        after_seq: record.cursor,
      },
      (event) => {
        // #region debug-point B-D:replay-event
        reportNativeReplayDebug('B-D', 'chatRuntime.ts:loadAuthoritativeTurnSnapshot.onEvent', 'replay event received', {
          eventType: event.event,
          hasSourceDelivery: Boolean(event.sourceDelivery),
          sequence: event.sourceDelivery?.sequence ?? null,
        });
        // #endregion
        if (event.event !== 'snapshot') {
          if (event.sourceDelivery) {
            eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
              streamId: record.streamId,
              streamGeneration: record.streamGeneration,
              ptid: record.actorId,
              conversationId: record.conversationId,
              agentId: record.agentId,
              event: event.event,
              data: event.data,
              timestampMs: Date.now(),
              sourceDelivery: event.sourceDelivery,
              deliveryOnly: true,
            } as SourceBoundReplayDelivery);
          }
          return;
        }
        try {
          finish(parseAuthoritativeTurnSnapshot(record, event));
        } catch (error) {
          finish(
            null,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
      (error) => finish(null, error),
      record.actorId,
    );
    if (abortRequested) controller.abort();
  });
}

function stopRecoverySubscription(conversationId: string): void {
  const subscription = recoverySubscriptions.get(conversationId);
  if (!subscription) return;
  recoverySubscriptions.delete(conversationId);
  subscription.controller.abort();
}

async function failRecovery(
  record: ActiveAgentTurnRecovery,
  recoveryEpoch: number,
  reason: string,
  error: Error,
): Promise<void> {
  const current = currentRecord(
    record.conversationId,
    record.turnId,
    record.streamGeneration,
    recoveryEpoch,
  );
  if (!current) return;
  const failed = transition(current, 'RECOVERY_FAILED', 'recovery_failed', {
    reason,
    error: error.message || 'chat.agentTurnRecovery.recoveryFailed',
  });
  if (!failed) return;
  try {
    await useChatStore
      .getState()
      .reconcileRecoveredTurn(failed.conversationId, failed.turnId, null);
  } catch (snapshotError) {
    log.warn('chatRuntime', 'durable Agent snapshot reload failed', {
      conversationId: failed.conversationId,
      turnId: failed.turnId,
      error: String(snapshotError),
    });
  }
  await persistActiveRecords();
}

async function consumeRecoveryEvent(
  record: ActiveAgentTurnRecovery,
  recoveryEpoch: number,
  event: StreamEvent,
): Promise<void> {
  if (!event.ptid || event.ptid !== actorId) return;
  const current = currentRecord(
    record.conversationId,
    record.turnId,
    record.streamGeneration,
    recoveryEpoch,
  );
  if (!current) return;

  if (event.event === 'connected') {
    await useChatStore
      .getState()
      .reconcileRecoveredTurn(current.conversationId, current.turnId, null);
  }

  const payload: AgentTurnStreamEventPayload = {
    streamId: current.streamId,
    streamGeneration: current.streamGeneration,
    ptid: event.ptid,
    conversationId: current.conversationId,
    agentId: current.agentId,
    event: event.event,
    data: {
      ...event.data,
      turnId: current.turnId,
      conversationId: current.conversationId,
      streamGeneration: current.streamGeneration,
    },
    timestampMs: Date.now(),
  };
  if (event.sourceDelivery) {
    const sourceDelivery: SourceBoundReplayDelivery = {
      ...payload,
      sourceDelivery: event.sourceDelivery,
      deliveryOnly: true,
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, sourceDelivery);
  }
  const reduction = useAgentTurnRecoveryStore.getState().consume(current.actorId, payload);
  if (!reduction.accepted) return;

  const terminal = terminalFromEvent(event);
  try {
    useChatStore
      .getState()
      .applyRecoveredTurnEvent(
        current.conversationId,
        current.agentId,
        current.turnId,
        { event: event.event, data: payload.data },
      );
    if (terminal) {
      await useChatStore
        .getState()
        .reconcileRecoveredTurn(current.conversationId, current.turnId, terminal);
    }
  } catch (error) {
    if (!terminal) throw error;
    log.warn('chatRuntime', 'terminal Agent turn message sync failed', {
      conversationId: current.conversationId,
      turnId: current.turnId,
      error: String(error),
    });
  } finally {
    if (terminal) {
      try {
        stopRecoverySubscription(current.conversationId);
      } finally {
        await persistActiveRecords();
      }
    } else {
      void persistActiveRecords();
    }
  }
}

function recoverTurn(
  record: ActiveAgentTurnRecovery,
  reason: string,
  force = false,
): void {
  const existing = recoverySubscriptions.get(record.conversationId);
  if (
    existing
    && existing.turnId === record.turnId
    && existing.streamGeneration === record.streamGeneration
    && !force
  ) {
    return;
  }
  stopRecoverySubscription(record.conversationId);

  const reconnecting = transition(record, 'RECONNECTING', 'reconnecting', { reason });
  if (!reconnecting) return;
  const replaying = transition(reconnecting, 'REPLAYING', 'replaying', { reason });
  if (!replaying) return;
  const recoveryEpoch = replaying.recoveryEpoch;

  const subscription: RecoverySubscription = {
    turnId: replaying.turnId,
    streamGeneration: replaying.streamGeneration,
    recoveryEpoch,
    controller: new AbortController(),
    eventChain: Promise.resolve(),
  };
  recoverySubscriptions.set(replaying.conversationId, subscription);
  subscription.controller = streamAgentTurnReplay(
    {
      conversation_id: replaying.conversationId,
      turn_id: replaying.turnId,
      after_seq: replaying.cursor,
    },
    (event) => {
      subscription.eventChain = subscription.eventChain
        .then(() => consumeRecoveryEvent(replaying, recoveryEpoch, event))
        .catch((error) => failRecovery(
          replaying,
          recoveryEpoch,
          reason,
          error instanceof Error ? error : new Error(String(error)),
        ));
    },
    (error) => {
      subscription.eventChain = subscription.eventChain
        .then(() => failRecovery(replaying, recoveryEpoch, reason, error));
    },
    replaying.actorId,
  );
}

function consumeLiveEvent(payload: AgentTurnStreamEventPayload): void {
  if ((payload as Partial<SourceBoundReplayDelivery>).deliveryOnly) return;
  const currentActorId = actorId;
  if (!currentActorId || payload.ptid !== currentActorId) return;
  const reduction = useAgentTurnRecoveryStore.getState().consume(currentActorId, payload);
  if (!reduction.accepted) return;

  const subscription = recoverySubscriptions.get(payload.conversationId);
  if (
    subscription
    && (
      payload.streamGeneration > subscription.streamGeneration
      || (reduction.terminal && payload.streamGeneration === subscription.streamGeneration)
    )
  ) {
    stopRecoverySubscription(payload.conversationId);
  }
  if (
    reduction.record?.phase === 'CONNECTION_LOST'
    && payload.data.recoveryHandoff === true
  ) {
    recoverTurn(reduction.record, 'connection-lost', true);
  }
  void persistActiveRecords();
}

function reconcileActiveTurns(
  reason: string,
  preservedFailedConversations: ReadonlySet<string> = new Set(),
): void {
  for (const record of Object.values(activeRecords())) {
    if (
      record.phase === 'RECOVERY_FAILED'
      && (
        reason !== 'bootstrap'
        || preservedFailedConversations.has(record.conversationId)
      )
    ) {
      continue;
    }
    recoverTurn(record, reason);
  }
}

function installTimer(): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    reconcileActiveTurns('periodic');
  }, RECOVERY_RECONCILE_INTERVAL_MS);
}

export function retryAgentTurnRecovery(conversationId: string): void {
  const record = activeRecords()[conversationId];
  if (!record || record.phase !== 'RECOVERY_FAILED') return;
  recoverTurn(record, 'user-retry', true);
}

export async function reloadAgentTurnSnapshot(
  conversationId: string,
): Promise<AgentTurnSnapshotReloadResult> {
  const record = activeRecords()[conversationId];
  if (!record) {
    throw new Error('chat.agentTurnRecovery.reloadTargetMissing');
  }
  stopRecoverySubscription(conversationId);
  try {
    const snapshot = await loadAuthoritativeTurnSnapshot(record);
    let current = currentRecord(
      record.conversationId,
      record.turnId,
      record.streamGeneration,
      record.recoveryEpoch,
    );
    if (!current) {
      throw new Error('chat.agentTurnRecovery.reloadTargetChanged');
    }
    await useChatStore
      .getState()
      .reconcileRecoveredTurn(
        current.conversationId,
        current.turnId,
        snapshot.terminal,
      );
    current = currentRecord(
      record.conversationId,
      record.turnId,
      record.streamGeneration,
      record.recoveryEpoch,
    );
    if (!current) {
      throw new Error('chat.agentTurnRecovery.reloadTargetChanged');
    }
    const reconciling = transition(
      current,
      'RECONCILING',
      'reconciling',
      {
        reason: 'user-snapshot-reload',
        status: snapshot.status,
      },
    );
    if (!reconciling) {
      throw new Error('chat.agentTurnRecovery.reloadTargetChanged');
    }
    const connected = transition(reconciling, 'CONNECTED', 'connected', {
      reason: 'user-snapshot-reload',
      status: snapshot.status,
    });
    if (!connected) {
      throw new Error('chat.agentTurnRecovery.reloadTargetChanged');
    }
    current = connected;
    const payload: AgentTurnStreamEventPayload = {
      streamId: current.streamId,
      streamGeneration: current.streamGeneration,
      ptid: current.actorId,
      conversationId: current.conversationId,
      agentId: current.agentId,
      event: snapshot.event.event,
      data: snapshot.event.data,
      timestampMs: Date.now(),
    };
    eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
      ...payload,
      sourceDelivery: snapshot.sourceDelivery,
      deliveryOnly: true,
    } as SourceBoundReplayDelivery);
    const reduction = useAgentTurnRecoveryStore
      .getState()
      .consume(current.actorId, payload);
    if (!reduction.accepted || Boolean(snapshot.terminal) !== reduction.terminal) {
      throw new Error('chat.agentTurnRecovery.snapshotRejected');
    }
    const result: AgentTurnSnapshotReloadResult = {
      source: 'station-snapshot-reconcile',
      actorId: current.actorId,
      conversationId: current.conversationId,
      turnId: current.turnId,
      streamId: current.streamId,
      streamGeneration: current.streamGeneration,
      status: snapshot.status,
      sequence: Number(snapshot.event.data.seq),
      terminal: reduction.terminal,
      terminalStatus: snapshot.terminal?.status ?? null,
      sourceDelivery: snapshot.sourceDelivery,
    };
    if (reduction.terminal) {
      stopRecoverySubscription(current.conversationId);
      await persistActiveRecords();
      return result;
    }
    if (!reduction.record) {
      throw new Error('chat.agentTurnRecovery.snapshotRejected');
    }
    return result;
  } catch (error) {
    const reloadError = error instanceof Error ? error : new Error(String(error));
    await failRecovery(
      record,
      record.recoveryEpoch,
      'user-snapshot-reload',
      reloadError,
    );
    throw reloadError;
  }
}

export const chatRuntime: RuntimeDescriptor = {
  id: 'agent-chat',
  scope: 'session',
  install() {
    if (installed) return;
    installed = true;
    unsubscribeStream = eventBus.subscribe(EVENT.AGENT_TURN_STREAM_EVENT, consumeLiveEvent);
    unsubscribeRecoveryRetry = eventBus.subscribe(
      EVENT.AGENT_TURN_RECOVERY_RETRY_REQUESTED,
      ({ conversationId }) => retryAgentTurnRecovery(conversationId),
    );
    installTimer();
  },
  teardown() {
    if (!installed) return;
    installed = false;
    actorBootstrapSequence += 1;
    unsubscribeStream?.();
    unsubscribeStream = null;
    unsubscribeRecoveryRetry?.();
    unsubscribeRecoveryRetry = null;
    if (reconcileTimer) clearInterval(reconcileTimer);
    reconcileTimer = null;
    for (const conversationId of recoverySubscriptions.keys()) {
      stopRecoverySubscription(conversationId);
    }
    actorId = null;
    persistence = null;
    useAgentTurnRecoveryStore.getState().reset();
  },
  async bootstrap(nextActorId) {
    if (!nextActorId) return;
    const bootstrapSequence = ++actorBootstrapSequence;
    const sessionUser = useSessionStore.getState().currentUser;
    const recoveryActorId = sessionUser?.actorId === nextActorId
      ? sessionUser.ptid || nextActorId
      : nextActorId;
    actorId = recoveryActorId;
    useAgentTurnRecoveryStore.getState().beginActor(recoveryActorId);
    const preservedFailedConversations = new Set(
      Object.values(activeRecords())
        .filter((record) => record.phase === 'RECOVERY_FAILED')
        .map((record) => record.conversationId),
    );
    const repository = createDesktopClientStorageRuntime({
      ptid: recoveryActorId,
    }).repositories.runtimeProjection;
    persistence = repository;
    const persisted = await repository.readValue(RECOVERY_STORAGE_KEY);
    if (
      !installed
      || actorId !== recoveryActorId
      || bootstrapSequence !== actorBootstrapSequence
      || persistence !== repository
    ) {
      return;
    }
    useAgentTurnRecoveryStore
      .getState()
      .mergePersisted(
        recoveryActorId,
        parsePersistedAgentTurnRecoveries(recoveryActorId, persisted),
      );
    reconcileActiveTurns('bootstrap', preservedFailedConversations);
  },
  async reconcile(reason) {
    reconcileActiveTurns(reason);
  },
};
