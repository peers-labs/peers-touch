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
const PHASE_BY_EVENT: Record<string, AgentTurnRecoveryPhase> = {
  connected: 'CONNECTED',
  connection_lost: 'CONNECTION_LOST',
  reconnecting: 'RECONNECTING',
  replaying: 'REPLAYING',
  reconciling: 'RECONCILING',
  recovery_failed: 'RECOVERY_FAILED',
};

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
  if (
    current
    && streamGeneration === current.streamGeneration
    && current.turnId !== turnId
  ) {
    return { accepted: false, terminal: false, record: current };
  }

  const terminal =
    TERMINAL_EVENTS.has(payload.event)
    || (payload.event === 'snapshot' && snapshotIsTerminal(payload.data));
  if (terminal && sequence === 0) {
    return { accepted: false, terminal: false, record: current };
  }
  if (
    current
    && current.turnId === turnId
    && current.streamGeneration === streamGeneration
    && (
      sequence < current.cursor
      || (
        terminal
        && payload.event !== 'snapshot'
        && sequence === current.cursor
      )
    )
  ) {
    return { accepted: false, terminal: false, record: current };
  }
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
      set((state) => state.actorId === nextActorId
        ? state
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

    consume: (nextActorId, payload) => {
      if (get().actorId !== nextActorId) {
        return { accepted: false, terminal: false };
      }
      const conversationId =
        stringField(payload.data, 'conversationId', 'conversation_id')
        || payload.conversationId.trim();
      const current = conversationId ? get().active[conversationId] : undefined;
      const reduction = reduceAgentTurnRecovery(nextActorId, current, payload);
      if (!reduction.accepted || !conversationId) return reduction;
      set((state) => {
        const active = { ...state.active };
        if (reduction.terminal) {
          delete active[conversationId];
        } else if (reduction.record) {
          active[conversationId] = reduction.record;
        }
        const turnId =
          stringField(payload.data, 'turnId', 'turn_id')
          || current?.turnId
          || '';
        const sequence = sequenceField(payload.data);
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
      return next;
    },

    clear: (conversationId, turnId) => {
      const current = get().active[conversationId];
      if (!current || current.turnId !== turnId) return;
      set((state) => {
        const active = { ...state.active };
        delete active[conversationId];
        return { active };
      });
    },

    reset: () => set({ actorId: null, active: {}, watermarks: {} }),
  }),
);
