import {
  api,
  type ChannelAutomation,
  type ChannelBindingInfo,
  type ChannelChat,
  type ChannelEventInfo,
  type ChannelHealth,
  type ChannelMemberAccess,
  type ChannelRequesterAuthorization,
  type ChannelRoute,
  type ChannelStats,
} from '../services/desktop_api';
import { log } from '../utils/logger';
import { createDesktopStore } from './createDesktopStore';
import { toStoreError } from './revalidation';

export type ChannelProjectionPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error';

export interface ChannelDetailProjection {
  routes: ChannelRoute[];
  automations: ChannelAutomation[];
  chats: ChannelChat[];
  memberAccess: ChannelMemberAccess[];
  events: ChannelEventInfo[];
  eventTotal: bigint;
  stats: ChannelStats | null;
  health: ChannelHealth | null;
  requesterAuthorization: ChannelRequesterAuthorization | null;
  loadedAt: number;
  partialErrors: string[];
}

interface ChannelState {
  actorPtid: string | null;
  phase: ChannelProjectionPhase;
  bindings: ChannelBindingInfo[];
  selectedBindingId: string | null;
  detailsByBindingId: Record<string, ChannelDetailProjection>;
  detailLoadingByBindingId: Record<string, boolean>;
  error: string | null;
  lastLoadedAt: number | null;
  setActorScope: (actorPtid: string | null) => void;
  loadBindings: (reason: string) => Promise<void>;
  selectBinding: (bindingId: string | null) => Promise<void>;
  loadBindingDetail: (bindingId: string, reason: string) => Promise<void>;
  reset: () => void;
}

let projectionEpoch = 0;
let bindingLoadSequence = 0;
const detailLoadSequence = new Map<string, number>();

function emptyState() {
  return {
    actorPtid: null,
    phase: 'idle' as ChannelProjectionPhase,
    bindings: [] as ChannelBindingInfo[],
    selectedBindingId: null,
    detailsByBindingId: {} as Record<string, ChannelDetailProjection>,
    detailLoadingByBindingId: {} as Record<string, boolean>,
    error: null as string | null,
    lastLoadedAt: null as number | null,
  };
}

async function settledValue<T>(
  operation: Promise<T>,
  fallback: T,
  errors: string[],
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    errors.push(toStoreError(error));
    return fallback;
  }
}

export const useChannelStore = createDesktopStore<ChannelState>(
  'channel',
  (set, get) => ({
    ...emptyState(),

    setActorScope: (actorPtid) => {
      if (get().actorPtid === actorPtid) return;
      projectionEpoch += 1;
      bindingLoadSequence += 1;
      detailLoadSequence.clear();
      set({ ...emptyState(), actorPtid });
    },

    loadBindings: async (reason) => {
      const actorPtid = get().actorPtid;
      if (!actorPtid) return;
      const epoch = projectionEpoch;
      const sequence = ++bindingLoadSequence;
      set({
        phase: get().bindings.length > 0 ? 'ready' : 'loading',
        error: null,
      });
      try {
        const bindings = await api.listChannelBindings();
        if (
          projectionEpoch !== epoch
          || bindingLoadSequence !== sequence
          || get().actorPtid !== actorPtid
        ) {
          return;
        }
        const selectedBindingId = get().selectedBindingId;
        set({
          bindings,
          selectedBindingId: selectedBindingId
            && bindings.some((binding) => binding.bindingId === selectedBindingId)
            ? selectedBindingId
            : null,
          phase: 'ready',
          error: null,
          lastLoadedAt: Date.now(),
        });
      } catch (error) {
        if (
          projectionEpoch !== epoch
          || bindingLoadSequence !== sequence
          || get().actorPtid !== actorPtid
        ) {
          return;
        }
        const message = toStoreError(error);
        set({ phase: 'error', error: message });
        log.warn('channel', 'binding projection load failed', {
          actorPtid,
          reason,
          error: message,
        });
        throw error;
      }
    },

    selectBinding: async (bindingId) => {
      set({ selectedBindingId: bindingId });
      if (bindingId) {
        await get().loadBindingDetail(bindingId, 'selection');
      }
    },

    loadBindingDetail: async (bindingId, reason) => {
      const actorPtid = get().actorPtid;
      if (!actorPtid || !bindingId) return;
      const epoch = projectionEpoch;
      const sequence = (detailLoadSequence.get(bindingId) ?? 0) + 1;
      detailLoadSequence.set(bindingId, sequence);
      set((state) => ({
        detailLoadingByBindingId: {
          ...state.detailLoadingByBindingId,
          [bindingId]: true,
        },
      }));

      const partialErrors: string[] = [];
      const [
        routes,
        automations,
        chats,
        memberAccess,
        eventPage,
        stats,
        health,
        requesterAuthorizationResponse,
      ] =
        await Promise.all([
          settledValue(api.listChannelRoutes(bindingId), [], partialErrors),
          settledValue(api.listChannelAutomations(bindingId), [], partialErrors),
          settledValue(api.listChannelChats(bindingId), [], partialErrors),
          settledValue(api.listChannelMemberAccess(bindingId), [], partialErrors),
          settledValue(
            api.listChannelEvents(bindingId, 50, 0),
            null,
            partialErrors,
          ),
          settledValue(api.getChannelStats(bindingId), null, partialErrors),
          settledValue(api.checkChannelHealth(bindingId), null, partialErrors),
          settledValue(
            api.getChannelRequesterAuthorization(bindingId),
            null,
            partialErrors,
          ),
        ]);

      if (
        projectionEpoch !== epoch
        || detailLoadSequence.get(bindingId) !== sequence
        || get().actorPtid !== actorPtid
      ) {
        return;
      }

      set((state) => ({
        detailsByBindingId: {
          ...state.detailsByBindingId,
          [bindingId]: {
            routes,
            automations,
            chats,
            memberAccess,
            events: eventPage?.events ?? [],
            eventTotal: eventPage?.total ?? 0n,
            stats,
            health,
            requesterAuthorization:
              requesterAuthorizationResponse?.authorization ?? null,
            loadedAt: Date.now(),
            partialErrors,
          },
        },
        detailLoadingByBindingId: {
          ...state.detailLoadingByBindingId,
          [bindingId]: false,
        },
      }));

      if (partialErrors.length > 0) {
        log.warn('channel', 'binding detail projection partially loaded', {
          bindingId,
          reason,
          errors: partialErrors,
        });
      }
    },

    reset: () => {
      projectionEpoch += 1;
      bindingLoadSequence += 1;
      detailLoadSequence.clear();
      set(emptyState());
    },
  }),
);
