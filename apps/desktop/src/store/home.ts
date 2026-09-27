import type { Timestamp } from '@bufbuild/protobuf/wkt';

import {
  HomeProjectionFreshness,
  HomeWorkKind,
  type HomeBriefItem,
  type HomeCapabilitySummary,
  type HomeNeedsUserItem,
  type HomeReadiness,
  type HomeSliceError,
  type HomeTaskProjection,
  type HomeWorkProjection,
} from '../gen/proto/domain/agent/home_pb';
import { createDesktopStore } from './createDesktopStore';

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

interface HomeState {
  projection: HomeProjectionView | null;
  loading: boolean;
  error: string | null;
  beginLoad: () => void;
  applyProjection: (projection: HomeWorkProjection) => void;
  failLoad: (error: string) => void;
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
  loading: false,
  error: null,

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
        loading: false,
        error: null,
      };
    }
    return {
      projection: normalizeHomeProjection(projection),
      loading: false,
      error: null,
    };
  }),

  failLoad: (error) => set({ loading: false, error }),

  reset: () => set({ projection: null, loading: false, error: null }),
}));
