import { createDesktopStore } from './createDesktopStore';
import type { AgentTurnStreamEventPayload } from '../kernel/events/types';

export type AgentTurnRecoveryPhase =
  | 'CONNECTED'
  | 'CONNECTION_LOST'
  | 'RECONNECTING'
  | 'REPLAYING'
  | 'RECONCILING'
  | 'RECOVERY_FAILED';

export interface ActiveAgentTurnRecovery {
  actorId: string;
  conversationId: string;
  agentId: string;
  turnId: string;
  streamId: string;
  streamGeneration: number;
  cursor: number;
  phase: AgentTurnRecoveryPhase;
  startedAt: number;
  updatedAt: number;
  recoveryEpoch: number;
  failureKey?: string;
}

export interface AgentTurnRecoveryReduction {
  accepted: boolean;
  terminal: boolean;
  record?: ActiveAgentTurnRecovery;
}

export interface AgentTurnRecoveryConsumeOptions {
  deferTerminalClosure?: boolean;
}

interface AgentTurnRecoveryWatermark {
  actorId: string;
  turnId: string;
  streamGeneration: number;
  cursor: number;
  updatedAt: number;
  terminal: boolean;
}

interface AgentTurnRecoveryState {
  actorId: string | null;
  active: Record<string, ActiveAgentTurnRecovery>;
  watermarks: Record<string, AgentTurnRecoveryWatermark>;
  beginActor: (actorId: string) => void;
  mergePersisted: (
    actorId: string,
    active: Record<string, ActiveAgentTurnRecovery>,
  ) => void;
  consume: (
    actorId: string,
    payload: AgentTurnStreamEventPayload,
    options?: AgentTurnRecoveryConsumeOptions,
  ) => AgentTurnRecoveryReduction;
  setPhase: (
    conversationId: string,
    turnId: string,
    phase: AgentTurnRecoveryPhase,
    failureKey?: string,
  ) => ActiveAgentTurnRecovery | null;
  clear: (conversationId: string, turnId: string) => void;
  reset: () => void;
}

const TERMINAL_EVENTS = new Set(['done', 'error', 'cancelled']);
const QUEUED_EVENTS = new Set(['queued', 'admission_replayed']);
const PHASE_BY_EVENT: Record<string, AgentTurnRecoveryPhase> = {
  connected: 'CONNECTED',
  connection_lost: 'CONNECTION_LOST',
  reconnecting: 'RECONNECTING',
  replaying: 'REPLAYING',
  reconciling: 'RECONCILING',
  recovery_failed: 'RECOVERY_FAILED',
};

// #region debug-point A-D:foundation-recovery-registration
function reportFoundationRecoveryRegistrationDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown>,
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7780/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-recovery-registration',
      runId: 'pre-fix',
      hypothesisId,
      location: 'agentTurnRecovery.ts',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

// #region debug-point A-D:foundation-recovery-error-key
function reportFoundationRecoveryErrorKeyDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown>,
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7782/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-recovery-error-key',
      runId: 'pre-fix',
      hypothesisId,
      location: 'agentTurnRecovery.ts',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

function stringField(
  data: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
): string {
  const value = data[camelCase] ?? data[snakeCase];
  return typeof value === 'string' ? value.trim() : '';
}

function sequenceField(data: Record<string, unknown>): number {
  const value = data.seq ?? data.sequence;
  const sequence = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0;
}

function snapshotIsTerminal(data: Record<string, unknown>): boolean {
  const status = String(data.status ?? '').toLowerCase();
  return ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
}

function recordIsNewer(
  candidate: ActiveAgentTurnRecovery,
  reference: ActiveAgentTurnRecovery,
): boolean {
  if (candidate.streamGeneration !== reference.streamGeneration) {
    return candidate.streamGeneration > reference.streamGeneration;
  }
  if (candidate.turnId !== reference.turnId) return false;
  if (candidate.cursor !== reference.cursor) return candidate.cursor > reference.cursor;
  return candidate.updatedAt > reference.updatedAt;
}

function watermarkSupersedesRecord(
  watermark: AgentTurnRecoveryWatermark | undefined,
  record: ActiveAgentTurnRecovery,
): boolean {
  if (!watermark || watermark.actorId !== record.actorId) return false;
  if (watermark.streamGeneration !== record.streamGeneration) {
    return watermark.streamGeneration > record.streamGeneration;
  }
  if (watermark.turnId !== record.turnId) return true;
  return watermark.terminal || watermark.cursor >= record.cursor;
}

export function reduceAgentTurnRecovery(
  actorId: string,
  current: ActiveAgentTurnRecovery | undefined,
  payload: AgentTurnStreamEventPayload,
  options: AgentTurnRecoveryConsumeOptions = {},
): AgentTurnRecoveryReduction {
  if (!payload.ptid || payload.ptid !== actorId) {
    return { accepted: false, terminal: false, record: current };
  }
  const conversationId =
    stringField(payload.data, 'conversationId', 'conversation_id')
    || payload.conversationId.trim();
  const turnId =
    stringField(payload.data, 'turnId', 'turn_id')
    || current?.turnId
    || '';
  if (!actorId || !conversationId || !turnId) {
    return { accepted: false, terminal: false };
  }
  if (QUEUED_EVENTS.has(payload.event)) {
    return { accepted: false, terminal: false, record: current };
  }
  if (current && current.actorId !== actorId) {
    return { accepted: false, terminal: false, record: current };
  }
  const streamGeneration = Number(payload.streamGeneration);
  if (!Number.isSafeInteger(streamGeneration) || streamGeneration <= 0) {
    return { accepted: false, terminal: false, record: current };
  }
  const sequence = sequenceField(payload.data);
  if (current && streamGeneration < current.streamGeneration) {
    return { accepted: false, terminal: false, record: current };
  }
  const terminalEvent =
    TERMINAL_EVENTS.has(payload.event)
    || (payload.event === 'snapshot' && snapshotIsTerminal(payload.data));
  if (
    current
    && current.turnId !== turnId
    && (terminalEvent || streamGeneration === current.streamGeneration)
  ) {
    return { accepted: false, terminal: false, record: current };
  }
  if (terminalEvent && sequence === 0) {
    return { accepted: false, terminal: false, record: current };
  }
  if (
    current
    && current.turnId === turnId
    && current.streamGeneration === streamGeneration
    && (
      sequence < current.cursor
      || (
        terminalEvent
        && payload.event !== 'snapshot'
        && sequence === current.cursor
      )
    )
  ) {
    return { accepted: false, terminal: false, record: current };
  }
  const terminal = terminalEvent && !options.deferTerminalClosure;
  if (terminal) {
    return { accepted: true, terminal: true };
  }
  if (
    current
    && current.turnId === turnId
    && current.streamGeneration === streamGeneration
    && sequence > 0
    && sequence <= current.cursor
    && !PHASE_BY_EVENT[payload.event]
  ) {
    return { accepted: false, terminal: false, record: current };
  }

  const now = payload.timestampMs;
  const record: ActiveAgentTurnRecovery = {
    actorId,
    conversationId,
    agentId: payload.agentId || current?.agentId || '',
    turnId,
    streamId: payload.streamId || current?.streamId || '',
    streamGeneration,
    cursor: Math.max(current?.cursor ?? 0, sequence),
    phase: PHASE_BY_EVENT[payload.event] ?? current?.phase ?? 'CONNECTED',
    startedAt: current?.startedAt ?? now,
    updatedAt: Math.max(current?.updatedAt ?? 0, now),
    recoveryEpoch: current?.recoveryEpoch ?? 0,
    failureKey:
      payload.event === 'recovery_failed'
        ? String(payload.data.error || 'chat.agentTurnRecovery.recoveryFailed')
        : undefined,
  };
  return { accepted: true, terminal: false, record };
}

export const useAgentTurnRecoveryStore = createDesktopStore<AgentTurnRecoveryState>(
  'agentTurnRecovery',
  (set, get) => ({
    actorId: null,
    active: {},
    watermarks: {},

    beginActor: (nextActorId) => {
      const state = get();
      const actorChanged = state.actorId !== nextActorId;
      reportFoundationRecoveryRegistrationDebug('B', 'actor-begin', {
        actorChanged,
        activeCount: Object.keys(state.active).length,
        watermarkCount: Object.keys(state.watermarks).length,
      });
      set((current) => current.actorId === nextActorId
        ? current
        : { actorId: nextActorId, active: {}, watermarks: {} });
    },

    mergePersisted: (nextActorId, persisted) => {
      set((state) => {
        if (state.actorId !== nextActorId) return state;
        const active = { ...state.active };
        for (const [conversationId, candidate] of Object.entries(persisted)) {
          if (
            candidate.actorId !== nextActorId
            || watermarkSupersedesRecord(state.watermarks[conversationId], candidate)
          ) {
            continue;
          }
          const current = active[conversationId];
          if (!current || recordIsNewer(candidate, current)) {
            active[conversationId] = candidate;
          }
        }
        return { active };
      });
    },

    consume: (nextActorId, payload, options) => {
      if (get().actorId !== nextActorId) {
        return { accepted: false, terminal: false };
      }
      const conversationId =
        stringField(payload.data, 'conversationId', 'conversation_id')
        || payload.conversationId.trim();
      const current = conversationId ? get().active[conversationId] : undefined;
      const turnId =
        stringField(payload.data, 'turnId', 'turn_id')
        || current?.turnId
        || '';
      const sequence = sequenceField(payload.data);
      const reduction = reduceAgentTurnRecovery(nextActorId, current, payload, options);
      const terminalEvent =
        TERMINAL_EVENTS.has(payload.event)
        || (payload.event === 'snapshot' && snapshotIsTerminal(payload.data));
      const shouldReport =
        !current || terminalEvent || Boolean(PHASE_BY_EVENT[payload.event]);
      if (!reduction.accepted || !conversationId) {
        if (shouldReport) {
          reportFoundationRecoveryRegistrationDebug(
            terminalEvent ? 'A-D' : 'B-C',
            'event-rejected',
            {
              eventType: payload.event,
              sequence,
              conversationPresent: Boolean(conversationId),
              hadActiveRecord: current !== undefined,
              actorMatches: payload.ptid === nextActorId,
              turnMatches: current?.turnId === turnId,
              generationMatches:
                current?.streamGeneration === payload.streamGeneration,
              terminalDeferred: options?.deferTerminalClosure === true,
            },
          );
        }
        return reduction;
      }
      set((state) => {
        const active = { ...state.active };
        if (reduction.terminal) {
          delete active[conversationId];
        } else if (reduction.record) {
          active[conversationId] = reduction.record;
        }
        return {
          active,
          watermarks: {
            ...state.watermarks,
            [conversationId]: {
              actorId: nextActorId,
              turnId,
              streamGeneration: payload.streamGeneration,
              cursor: Math.max(current?.cursor ?? 0, sequence),
              updatedAt: Math.max(current?.updatedAt ?? 0, payload.timestampMs),
              terminal: reduction.terminal,
            },
          },
        };
      });
      if (shouldReport) {
        const activeAfter = get().active[conversationId];
        reportFoundationRecoveryRegistrationDebug(
          terminalEvent ? 'A-D' : 'B-C',
          'event-consumed',
          {
            eventType: payload.event,
            sequence: sequenceField(payload.data),
            hadActiveRecord: current !== undefined,
            actorMatches: payload.ptid === nextActorId,
            turnMatches: current?.turnId === turnId,
            generationMatches:
              current?.streamGeneration === payload.streamGeneration,
            reductionAccepted: reduction.accepted,
            reductionTerminal: reduction.terminal,
            terminalDeferred: options?.deferTerminalClosure === true,
            activeRecordPresentAfter: activeAfter !== undefined,
            activePhaseAfter: activeAfter?.phase ?? 'MISSING',
          },
        );
        if (payload.event === 'recovery_failed') {
          reportFoundationRecoveryErrorKeyDebug(
            'A-C',
            'recovery-failed-event-consumed',
            {
              sequence,
              sameSequenceAsCurrent: current?.cursor === sequence,
              olderThanCurrent: Boolean(current && sequence < current.cursor),
              eventErrorPresent:
                typeof payload.data.error === 'string'
                && payload.data.error.trim().length > 0,
              eventReasonPresent:
                typeof payload.data.reason === 'string'
                && payload.data.reason.trim().length > 0,
              eventErrorCodePresent:
                typeof (payload.data.errorCode ?? payload.data.error_code) === 'string'
                && String(
                  payload.data.errorCode ?? payload.data.error_code,
                ).trim().length > 0,
              currentFailureKeyPresent: Boolean(current?.failureKey),
              reducedFailureKeyPresent: Boolean(reduction.record?.failureKey),
              activeFailureKeyPresent: Boolean(activeAfter?.failureKey),
            },
          );
        }
      }
      return reduction;
    },

    setPhase: (conversationId, turnId, phase, failureKey) => {
      const current = get().active[conversationId];
      if (!current || current.turnId !== turnId) return null;
      const next = {
        ...current,
        phase,
        failureKey,
        recoveryEpoch:
          phase === 'RECONNECTING'
          || (phase === 'RECONCILING' && current.phase === 'RECOVERY_FAILED')
            ? current.recoveryEpoch + 1
            : current.recoveryEpoch,
        updatedAt: Date.now(),
      };
      set((state) => ({
        active: { ...state.active, [conversationId]: next },
      }));
      if (phase === 'RECOVERY_FAILED' || current.phase === 'RECOVERY_FAILED') {
        reportFoundationRecoveryErrorKeyDebug(
          'A-D',
          'phase-transitioned',
          {
            previousPhase: current.phase,
            nextPhase: phase,
            failureKeyArgumentPresent: Boolean(failureKey),
            previousFailureKeyPresent: Boolean(current.failureKey),
            nextFailureKeyPresent: Boolean(next.failureKey),
            recoveryEpochBefore: current.recoveryEpoch,
            recoveryEpochAfter: next.recoveryEpoch,
          },
        );
      }
      return next;
    },

    clear: (conversationId, turnId) => {
      const current = get().active[conversationId];
      if (!current || current.turnId !== turnId) return;
      reportFoundationRecoveryRegistrationDebug('A-D', 'record-cleared', {
        activeCount: Object.keys(get().active).length,
        phase: current.phase,
        cursor: current.cursor,
        generationMatches: current.streamGeneration > 0,
      });
      set((state) => {
        const active = { ...state.active };
        delete active[conversationId];
        return { active };
      });
    },

    reset: () => {
      reportFoundationRecoveryRegistrationDebug('B', 'store-reset', {
        activeCount: Object.keys(get().active).length,
        watermarkCount: Object.keys(get().watermarks).length,
      });
      set({ actorId: null, active: {}, watermarks: {} });
    },
  }),
);
