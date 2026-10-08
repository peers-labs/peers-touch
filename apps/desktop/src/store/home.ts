import type { Timestamp } from '@bufbuild/protobuf/wkt';

import {
  HomeProjectionFreshness,
  HomeTaskStatus,
  HomeWorkKind,
  type HomeBriefItem,
  type HomeCapabilitySummary,
  type HomeNeedsUserItem,
  type HomeReadiness,
  type HomeSliceError,
  type HomeTaskProjection,
  type HomeWorkProjection,
} from '../gen/proto/domain/agent/home_pb';
import type { AgentGoal } from '../gen/proto/domain/agent/goal_pb';
import type { RealtimeAgentDomainEventPayload } from '../kernel/events/types';
import { createDesktopStore } from './createDesktopStore';

export const TASK_RUN_LIFECYCLE_STATUSES = [
  'pending',
  'running',
  'needs_user',
  'completed',
  'failed',
  'cancelled',
  'unavailable',
] as const;

export type TaskRunLifecycleStatus =
  (typeof TASK_RUN_LIFECYCLE_STATUSES)[number];

export function normalizeHomeTaskRunStatus(
  status: HomeTaskStatus,
): TaskRunLifecycleStatus {
  switch (status) {
    case HomeTaskStatus.PENDING:
      return 'pending';
    case HomeTaskStatus.RUNNING:
      return 'running';
    case HomeTaskStatus.NEEDS_USER:
      return 'needs_user';
    case HomeTaskStatus.COMPLETED:
      return 'completed';
    case HomeTaskStatus.FAILED:
      return 'failed';
    case HomeTaskStatus.CANCELLED:
      return 'cancelled';
    default:
      return 'unavailable';
  }
}

export interface HomePinnedAgentView {
  agentId: string;
  agentName: string;
  displayName: string;
  avatarRef: string;
  readinessSnapshotId: string;
  agentVersion: bigint;
  providerId: string;
  modelId: string;
}

export interface HomeRecentWorkView {
  workId: string;
  kind: HomeWorkKind;
  agentId: string;
  agentName: string;
  title: string;
  updatedAt: string;
}

export interface HomeProjectionView {
  ptid: string;
  revision: bigint;
  freshness: HomeProjectionFreshness;
  pinnedAgents: HomePinnedAgentView[];
  recentWork: HomeRecentWorkView[];
  readiness: HomeReadiness[];
  briefItems: HomeBriefItem[];
  needsUserItems: HomeNeedsUserItem[];
  activeTasks: HomeTaskProjection[];
  capabilitySummaries: HomeCapabilitySummary[];
  sliceErrors: HomeSliceError[];
}

export type HomeConnectionState =
  | 'fresh'
  | 'reconnecting'
  | 'resyncing'
  | 'stale'
  | 'unauthorized';

interface HomeState {
  projection: HomeProjectionView | null;
  lastAgentEvent: RealtimeAgentDomainEventPayload | null;
  agentEventCursors: Record<string, {
    domainEventId: string;
    domainSequence: bigint;
    goalRevision: bigint;
  }>;
  connectionState: HomeConnectionState;
  retryable: boolean;
  loading: boolean;
  error: string | null;
  goalDraftTitle: string;
  goalDraftOutcome: string;
  goalDraftIdempotencyKey: string;
  savedGoal: AgentGoal | null;
  goalCreating: boolean;
  goalReadbackLoading: boolean;
  goalReadbackRevision: bigint | null;
  goalCreateError: string | null;
  goalReadbackError: string | null;
  beginLoad: () => void;
  applyProjection: (projection: HomeWorkProjection) => void;
  applyAgentDomainEvent: (
    event: RealtimeAgentDomainEventPayload,
  ) => boolean;
  markConnectionLost: () => void;
  beginResync: () => void;
  failLoad: (error: string, unauthorized?: boolean) => void;
  setGoalDraftTitle: (title: string) => void;
  setGoalDraftOutcome: (outcome: string) => void;
  beginGoalCreate: (idempotencyKey: string) => void;
  applyGoalDraft: (goal: AgentGoal, source: 'create' | 'readback') => void;
  failGoalCreate: (error: string) => void;
  beginGoalReadback: () => void;
  failGoalReadback: (error: string) => void;
  reset: () => void;
}

function timestampToISO(value?: Timestamp): string {
  if (!value) return '';
  const milliseconds =
    Number(value.seconds) * 1_000 + Math.floor(value.nanos / 1_000_000);
  return new Date(milliseconds).toISOString();
}

export function normalizeHomeProjection(
  projection: HomeWorkProjection,
): HomeProjectionView {
  return {
    ptid: projection.ptid,
    revision: projection.revision,
    freshness: projection.freshness,
    pinnedAgents: projection.pinnedAgents.map((agent) => ({
      agentId: agent.agentId,
      agentName: agent.agentName || agent.displayName,
      displayName: agent.displayName,
      avatarRef: agent.avatarRef,
      readinessSnapshotId: agent.readinessSnapshotId,
      agentVersion: agent.agentVersion,
      providerId: agent.providerId,
      modelId: agent.modelId,
    })),
    recentWork: projection.recentWork.map((work) => ({
      workId: work.workId,
      kind: work.kind,
      agentId: work.agentId,
      agentName:
        projection.pinnedAgents.find((agent) => agent.agentId === work.agentId)
          ?.agentName || work.agentId,
      title: work.title,
      updatedAt: timestampToISO(work.updatedAt),
    })),
    readiness: projection.readiness,
    briefItems: projection.briefItems,
    needsUserItems: projection.needsUserItems,
    activeTasks: projection.activeTasks,
    capabilitySummaries: projection.capabilitySummaries,
    sliceErrors: projection.sliceErrors,
  };
}

export const useHomeStore = createDesktopStore<HomeState>('home', (set) => ({
  projection: null,
  lastAgentEvent: null,
  agentEventCursors: {},
  connectionState: 'resyncing',
  retryable: false,
  loading: false,
  error: null,
  goalDraftTitle: '',
  goalDraftOutcome: '',
  goalDraftIdempotencyKey: '',
  savedGoal: null,
  goalCreating: false,
  goalReadbackLoading: false,
  goalReadbackRevision: null,
  goalCreateError: null,
  goalReadbackError: null,

  beginLoad: () => set({ loading: true, error: null }),

  applyProjection: (projection) => set((state) => {
    if (
      state.projection
      && state.projection.ptid === projection.ptid
      && projection.revision < state.projection.revision
    ) {
      return {
        projection: {
          ...state.projection,
          freshness: HomeProjectionFreshness.STALE,
          sliceErrors: projection.sliceErrors,
        },
        connectionState: 'stale',
        retryable: projection.sliceErrors.some((slice) => slice.retryable),
        loading: false,
        error: null,
      };
    }
    return {
      projection: normalizeHomeProjection(projection),
      connectionState:
        projection.freshness === HomeProjectionFreshness.FRESH
          ? 'fresh'
          : 'stale',
      retryable:
        projection.freshness !== HomeProjectionFreshness.FRESH
        && projection.sliceErrors.some((slice) => slice.retryable),
      loading: false,
      error: null,
    };
  }),

  applyAgentDomainEvent: (event) => {
    const cursorKey = event.taskId
      ? `task:${event.taskId}`
      : `goal:${event.goalId}`;
    let accepted = false;
    set((state) => {
      const cursor = state.agentEventCursors[cursorKey];
      if (
        event.schemaVersion !== 1
        || !event.domainEventId
        || event.domainSequence <= 0n
        || (!event.goalId && !event.taskId)
        || (
          cursor
          && (
            event.domainSequence <= cursor.domainSequence
            || event.goalRevision < cursor.goalRevision
          )
        )
      ) {
        return state;
      }
      accepted = true;
      return {
        lastAgentEvent: event,
        agentEventCursors: {
          ...state.agentEventCursors,
          [cursorKey]: {
            domainEventId: event.domainEventId,
            domainSequence: event.domainSequence,
            goalRevision: event.goalRevision,
          },
        },
      };
    });
    return accepted;
  },

  markConnectionLost: () => set({
    connectionState: 'reconnecting',
    retryable: false,
  }),

  beginResync: () => set({
    connectionState: 'resyncing',
    retryable: false,
    loading: true,
    error: null,
  }),

  failLoad: (error, unauthorized = false) => set({
    connectionState: unauthorized ? 'unauthorized' : 'stale',
    retryable: !unauthorized,
    loading: false,
    error,
  }),

  setGoalDraftTitle: (title) => set({
    goalDraftTitle: title,
    goalDraftIdempotencyKey: '',
    goalCreateError: null,
  }),

  setGoalDraftOutcome: (outcome) => set({
    goalDraftOutcome: outcome,
    goalDraftIdempotencyKey: '',
    goalCreateError: null,
  }),

  beginGoalCreate: (idempotencyKey) => set({
    goalDraftIdempotencyKey: idempotencyKey,
    goalCreating: true,
    goalCreateError: null,
  }),

  applyGoalDraft: (goal, source) => set((state) => {
    if (
      state.savedGoal?.goalId === goal.goalId
      && goal.revision < state.savedGoal.revision
    ) {
      return {
        goalCreating: false,
        goalReadbackLoading: false,
        goalReadbackError: 'agent.home.goalReadbackStale',
      };
    }
    return {
      goalDraftTitle: goal.title,
      goalDraftOutcome: goal.outcome,
      savedGoal: goal,
      goalCreating: false,
      goalReadbackLoading: false,
      goalReadbackRevision:
        source === 'readback' ? goal.revision : state.goalReadbackRevision,
      goalCreateError: null,
      goalReadbackError: null,
    };
  }),

  failGoalCreate: (error) => set({
    goalCreating: false,
    goalCreateError: error,
  }),

  beginGoalReadback: () => set({
    goalReadbackLoading: true,
    goalReadbackError: null,
  }),

  failGoalReadback: (error) => set({
    goalReadbackLoading: false,
    goalReadbackError: error,
  }),

  reset: () => set({
    projection: null,
    lastAgentEvent: null,
    agentEventCursors: {},
    connectionState: 'resyncing',
    retryable: false,
    loading: false,
    error: null,
    goalDraftTitle: '',
    goalDraftOutcome: '',
    goalDraftIdempotencyKey: '',
    savedGoal: null,
    goalCreating: false,
    goalReadbackLoading: false,
    goalReadbackRevision: null,
    goalCreateError: null,
    goalReadbackError: null,
  }),
}));
