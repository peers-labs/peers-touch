import type { MobileAuthSession } from '../auth/authSession';
import {
  type SocialHostEvent,
  type SocialHostEventKind,
} from '@peers-touch/client-chat-core';
import type { GroupState } from '../group/groupStore';
import { restoreAndRevalidateAccessRuntime } from '../../runtimes/accessRuntime';
import {
  MOBILE_MESSAGING_RUNTIME_ERROR_EVENT,
  wakeActiveMessagingSession,
} from '../../runtimes/messagingRuntime';
import {
  applyReliabilityProjectionCheckpoints,
} from '../../runtimes/commandRuntime';
import {
  createSocialProjectionRuntime,
  readActiveSocialIngressState,
  type ProjectionDomain,
  type SocialProjectionRuntimeController,
} from '../../runtimes/socialProjectionRuntime';
import type { SocialState } from './socialStore';
import { useSocialStore } from './socialStore';
import { startRealtimeStream } from './socialRealtime';
import {
  readableErrorMessage,
  SocialApiError,
  type ActorSearchResult,
  type PeerProfile,
} from './socialTypes';
import { mobileCallManager } from '../call/callState';
import type {
  FriendRequestMutationResult,
} from '../../services/gateways/socialGateway';
import type {
  EditableProfileInput,
  ProfileUpdateResult,
} from '../../services/gateways/profileGateway';
import { executeStationOperation } from '../../services/stationTransport';

const RECONCILE_INTERVAL_MS = 30000;
const TYPING_TTL_MS = 6000;
const TYPING_SWEEP_INTERVAL_MS = 2000;
const EXTERNAL_RECONCILE_DEBOUNCE_MS = 1000;
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 15000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 30000;

export interface SocialRuntimeController {
  suspend: () => Promise<void>;
  resume: () => Promise<void>;
  teardown: () => Promise<void>;
  drain: () => Promise<void>;
}

export type SocialRuntimeExternalEventKind = SocialHostEventKind;
export type SocialRuntimeExternalEvent = SocialHostEvent;

interface ActiveSocialRuntime {
  sessionKey: string | null;
  dispatchExternalEvent: (event: SocialRuntimeExternalEvent) => void;
  reconcile: (reason: string, domains?: readonly ProjectionDomain[]) => Promise<void>;
  requestBlockedUsers: () => Promise<void>;
  requestCurrentUserProfile: (force?: boolean) => Promise<void>;
  requestPeerProfiles: (peerPtids: readonly string[], force?: boolean) => Promise<void>;
  requestFriendshipStatus: (targetPtid: string) => Promise<void>;
  unblockUser: (targetPtid: string) => Promise<void>;
}

let activeRuntime: ActiveSocialRuntime | null = null;

export function dispatchSocialRuntimeExternalEvent(event: SocialRuntimeExternalEvent) {
  activeRuntime?.dispatchExternalEvent(event);
}

export interface SocialRuntimePublicProjection {
  active: boolean;
  activeSessionUlid: string | null;
  friendRequests: Array<{
    requestId: string;
    federationId: string;
    senderPtid: string;
    receiverPtid: string;
    senderHomeStationPeerId: string;
    receiverHomeStationPeerId: string;
    status: number;
  }>;
  typingPeers: Record<string, Record<string, {
    typing: boolean;
    lastUpdate: number;
  }>>;
  peerOnline: Record<string, boolean>;
  lastReconcileAt: number | null;
  ingress: {
    lifecycle: 'active' | 'suspended' | 'torn';
    streamCursor: string;
    writeAdmissionOpen: boolean;
    staleDomains: string[];
    dataQueueDepth: number;
    controlQueueDepth: number;
  } | null;
}

export interface SocialFriendRequestSubmission {
  readonly command: FriendRequestMutationResult['command'];
  readonly projection: SocialRuntimePublicProjection;
}

export function readSocialRuntimeProjection(): SocialRuntimePublicProjection {
  const state = useSocialStore.getState();
  const ingress = readActiveSocialIngressState();
  return {
    active: activeRuntime !== null,
    activeSessionUlid: state.activeSessionUlid,
    friendRequests: state.friendRequests.map((request) => ({
      requestId: request.requestId || request.id || '',
      federationId: request.federationId,
      senderPtid: request.senderPtid,
      receiverPtid: request.receiverPtid,
      senderHomeStationPeerId: request.senderHomeStationPeerId,
      receiverHomeStationPeerId: request.receiverHomeStationPeerId,
      status: request.status,
    })),
    typingPeers: Object.fromEntries(
      Object.entries(state.typingPeers).map(([conversationId, peers]) => [
        conversationId,
        Object.fromEntries(
          Object.entries(peers).map(([ptid, entry]) => [
            ptid,
            {
              typing: entry.typing,
              lastUpdate: entry.lastUpdate,
            },
          ]),
        ),
      ]),
    ),
    peerOnline: { ...state.peerOnline },
    lastReconcileAt: state.lastReconcileAt,
    ingress: ingress
      ? {
          lifecycle: ingress.lifecycle,
          streamCursor: ingress.streamCursor,
          writeAdmissionOpen: ingress.writeAdmission.open,
          staleDomains: Object.entries(ingress.staleness)
            .filter(([, value]) => value.stale)
            .map(([domain]) => domain),
          dataQueueDepth: ingress.dataQueueDepth,
          controlQueueDepth: ingress.controlQueueDepth,
        }
      : null,
  };
}

export async function sendSocialFriendRequest(
  receiverPtid: string,
  receiverHomeStationPeerId: string,
  federationId: string,
  message?: string,
): Promise<SocialRuntimePublicProjection> {
  const submission = await submitSocialFriendRequest(
    receiverPtid,
    receiverHomeStationPeerId,
    federationId,
    message,
  );
  return submission.projection;
}

export async function submitSocialFriendRequest(
  receiverPtid: string,
  receiverHomeStationPeerId: string,
  federationId: string,
  message?: string,
): Promise<SocialFriendRequestSubmission> {
  requireActiveSocialRuntime();
  const command = await useSocialStore.getState().sendFriendRequest(
    receiverPtid,
    receiverHomeStationPeerId,
    federationId,
    message,
  );
  return {
    command,
    projection: readSocialRuntimeProjection(),
  };
}

export async function acceptSocialFriendRequest(
  requestId: string,
): Promise<SocialRuntimePublicProjection> {
  requireActiveSocialRuntime();
  await useSocialStore.getState().acceptFriendRequest(requestId);
  return readSocialRuntimeProjection();
}

export async function reconcileSocialRuntime(): Promise<SocialRuntimePublicProjection> {
  const runtime = requireActiveSocialRuntime();
  await runtime.reconcile('explicit-request');
  return readSocialRuntimeProjection();
}

export async function readFederationContexts() {
  requireActiveSocialRuntime();
  const gateway = useSocialStore.getState().profileGateway;
  if (!gateway) throw new Error('mobile.social.runtimeUnavailable');
  const result = await gateway.listFederationContexts();
  if (!result.ok) throw new SocialApiError(result.error);
  return result.data.map((context) => ({
    federationId: context.federationId,
    name: context.name,
    status: context.status,
  }));
}

export async function searchSocialPeople(query: string, federationId: string): Promise<ActorSearchResult[]> {
  requireActiveSocialRuntime();
  await useSocialStore.getState().searchPeople(query, federationId);
  const state = useSocialStore.getState();
  if (state.peopleSearchError) throw state.peopleSearchError;
  return [...state.peopleSearchResults];
}

export async function reconcileSocialRuntimeDomains(
  reason: string,
  domains: readonly ProjectionDomain[],
): Promise<void> {
  const runtime = requireActiveSocialRuntime();
  await runtime.reconcile(reason, domains);
}

export async function requestSocialCurrentUserProfile(
  force = false,
): Promise<void> {
  if (!activeRuntime) return;
  await activeRuntime.requestCurrentUserProfile(force);
}

export async function readCurrentSocialProfile(
  force = false,
): Promise<{ actorPtid: string; profile: PeerProfile }> {
  const runtime = requireActiveSocialRuntime();
  await runtime.requestCurrentUserProfile(force);
  const state = useSocialStore.getState();
  if (!state.currentUserPtid || !state.currentUserProfile) {
    throw new Error('mobile.social.currentProfileUnavailable');
  }
  return {
    actorPtid: state.currentUserPtid,
    profile: state.currentUserProfile,
  };
}

export async function updateCurrentSocialProfile(
  input: EditableProfileInput,
): Promise<{ actorPtid: string; result: ProfileUpdateResult }> {
  requireActiveSocialRuntime();
  const state = useSocialStore.getState();
  const result = await state.updateCurrentUserProfile(input);
  const actorPtid = useSocialStore.getState().currentUserPtid;
  if (!actorPtid) throw new Error('mobile.social.currentProfileUnavailable');
  return { actorPtid, result };
}

export async function requestSocialBlockedUsers(): Promise<void> {
  const runtime = requireActiveSocialRuntime();
  await runtime.requestBlockedUsers();
}

export async function requestSocialPeerProfiles(
  peerPtids: readonly string[],
  force = false,
): Promise<void> {
  if (!activeRuntime) return;
  await activeRuntime.requestPeerProfiles(peerPtids, force);
}

export function requestSocialPeerProfile(
  peerPtid: string,
  force = false,
): Promise<void> {
  return requestSocialPeerProfiles([peerPtid], force);
}

export async function requestSocialFriendshipStatus(
  targetPtid: string,
): Promise<void> {
  if (!activeRuntime) return;
  await activeRuntime.requestFriendshipStatus(targetPtid);
}

export async function unblockSocialUser(targetPtid: string): Promise<void> {
  const runtime = requireActiveSocialRuntime();
  await runtime.unblockUser(targetPtid);
}

export async function applySocialFriendRequestProjectionCheckpoints(
  stationPeerId: string,
  actorPtid: string,
  runtimeGeneration: number,
): Promise<number> {
  return applyReliabilityProjectionCheckpoints(
    stationPeerId,
    actorPtid,
    runtimeGeneration,
    async () => {
      const state = useSocialStore.getState();
      await Promise.all([
        state.refreshFriendRequests(),
        state.refreshBlockedUsers(),
      ]);
    },
  );
}

function requireActiveSocialRuntime(): ActiveSocialRuntime {
  if (!activeRuntime) throw new Error('mobile.social.runtimeUnavailable');
  return activeRuntime;
}

interface ForegroundResources {
  readonly abortController: AbortController;
  readonly reconcileTimer: number;
  readonly typingSweepTimer: number;
  readonly presenceHeartbeatTimer: number;
}

export async function startSocialRuntime(
  session: MobileAuthSession,
  getSocialStore: () => SocialState,
  getGroupStore: () => GroupState,
): Promise<SocialRuntimeController> {
  let torn = false;
  let suspended = false;
  let externalReconcileTimer: number | null = null;
  let foreground: ForegroundResources | null = null;
  const pendingOperations = new Set<Promise<unknown>>();
  const track = <T,>(operation: () => Promise<T>): Promise<T> => {
    const pending = operation().finally(() => {
      pendingOperations.delete(pending);
    });
    pendingOperations.add(pending);
    return pending;
  };

  const projectionRuntime = createSocialProjectionRuntime(
    session,
    getSocialStore,
    getGroupStore,
    {
      wakeMessaging,
      revalidateSession: async () => {
        await restoreAndRevalidateAccessRuntime();
      },
      ingestCallSignal: (event) => {
        void mobileCallManager
          .ingestRealtimeSignal(event)
          .catch((error) => reportSocialRuntimeError('call-signal', error));
      },
      reportError: reportSocialRuntimeError,
    },
  );
  await mobileCallManager.activate(session);
  await projectionRuntime.bootstrap();

  const runtimeRef: ActiveSocialRuntime = {
    sessionKey: getSocialStore().sessionKey,
    dispatchExternalEvent: (event) => {
      if (torn) return;
      projectionRuntime.dispatchExternalEvent(event);

      if (externalReconcileTimer) return;
      externalReconcileTimer = window.setTimeout(() => {
        externalReconcileTimer = null;
        if (!torn && !suspended) {
          void track(() => projectionRuntime.reconcile('host-wakeup'));
        }
      }, EXTERNAL_RECONCILE_DEBOUNCE_MS);
    },
    reconcile: async (reason, domains) => {
      if (projectionRuntime.ingress.state().lifecycle === 'suspended') {
        await projectionRuntime.resume();
        suspended = false;
        startForeground();
        return;
      }
      await projectionRuntime.reconcile(reason, domains);
    },
    requestBlockedUsers: () => track(
      () => getSocialStore().refreshBlockedUsers(),
    ),
    requestCurrentUserProfile: (force) =>
      projectionRuntime.requestCurrentUserProfile(force),
    requestPeerProfiles: (peerPtids, force) =>
      projectionRuntime.requestPeerProfiles(peerPtids, force),
    requestFriendshipStatus: (targetPtid) =>
      projectionRuntime.requestFriendshipStatus(targetPtid),
    unblockUser: (targetPtid) => track(async () => {
      await getSocialStore().unblockUser(targetPtid);
      await getSocialStore().refreshBlockedUsers();
    }),
  };
  activeRuntime = runtimeRef;
  startForeground();

  return {
    suspend: async () => {
      if (torn || suspended) return;
      suspended = true;
      await projectionRuntime.suspend();
      mobileCallManager.suspend();
      await stopForeground('runtime_suspend');
    },
    resume: async () => {
      if (
        torn
        || (
          !suspended
          && foreground
          && projectionRuntime.ingress.state().lifecycle === 'active'
        )
      ) return;
      await projectionRuntime.resume();
      await mobileCallManager.resume();
      suspended = false;
      startForeground();
    },
    teardown: async () => {
      if (torn) return;
      torn = true;
      if (externalReconcileTimer) {
        window.clearTimeout(externalReconcileTimer);
        externalReconcileTimer = null;
      }
      await stopForeground('runtime_teardown');
      await projectionRuntime.teardown();
      mobileCallManager.reset();
      if (activeRuntime === runtimeRef) activeRuntime = null;
    },
    drain: async () => {
      await drainPendingOperations(pendingOperations);
      await projectionRuntime.drain();
    },
  };

  function startForeground(): void {
    if (torn || suspended || foreground) return;
    const abortController = new AbortController();
    const reconcileTimer = window.setInterval(() => {
      if (!torn && !suspended) {
        void track(() => projectionRuntime.reconcile('periodic'));
      }
    }, RECONCILE_INTERVAL_MS);
    const typingSweepTimer = window.setInterval(() => {
      getSocialStore().sweepTypingPeers(Date.now() - TYPING_TTL_MS);
    }, TYPING_SWEEP_INTERVAL_MS);
    const presenceHeartbeatTimer = window.setInterval(() => {
      if (!torn && !suspended) {
        void track(() => postPresence(session, 'heartbeat', 'heartbeat'));
      }
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    foreground = {
      abortController,
      reconcileTimer,
      typingSweepTimer,
      presenceHeartbeatTimer,
    };
    void track(() => postPresence(session, 'heartbeat', 'runtime_start'));
    void track(() => superviseRealtimeStream(
      session,
      abortController.signal,
      projectionRuntime,
    ));
  }

  async function stopForeground(reason: string): Promise<void> {
    const resources = foreground;
    if (!resources) return;
    foreground = null;
    window.clearInterval(resources.reconcileTimer);
    window.clearInterval(resources.typingSweepTimer);
    window.clearInterval(resources.presenceHeartbeatTimer);
    resources.abortController.abort();
    await postPresence(session, 'offline', reason);
    await drainPendingOperations(pendingOperations);
  }
}

async function postPresence(
  session: MobileAuthSession,
  kind: 'heartbeat' | 'offline',
  reason: string,
) {
  try {
    await executeStationOperation(session, {
      operationId: kind === 'heartbeat'
        ? 'presence_heartbeat'
        : 'presence_offline',
      reason,
    });
  } catch {
    // Presence is lease-based; the next heartbeat or server-side TTL heals failures.
  }
}

async function superviseRealtimeStream(
  session: MobileAuthSession,
  signal: AbortSignal,
  projectionRuntime: SocialProjectionRuntimeController,
) {
  let reconnectDelay = REALTIME_RECONNECT_BASE_MS;
  while (!signal.aborted) {
    try {
      await startRealtimeStream(
        session,
        signal,
        {
          onConnected: (cursor) => {
            projectionRuntime.ingress.ingestControlEvent({
              domain: 'control',
              kind: 'stream-connected',
              payload: {},
              cursor,
              timestampMs: Date.now(),
            });
          },
          onEvent: projectionRuntime.ingestRealtimeEvent,
        },
        projectionRuntime.ingress.state().streamCursor,
      );
      reconnectDelay = REALTIME_RECONNECT_BASE_MS;
    } catch (error) {
      if (signal.aborted) return;
      reportSocialRuntimeError('realtime-stream', error);
    }

    if (signal.aborted) return;
    projectionRuntime.ingress.ingestControlEvent({
      domain: 'control',
      kind: 'stream-disconnected',
      payload: {},
      cursor: projectionRuntime.ingress.state().streamCursor,
      timestampMs: Date.now(),
    });
    await projectionRuntime.reconcile('stream-reconnect');
    await delay(reconnectDelay, signal);
    reconnectDelay = Math.min(reconnectDelay * 2, REALTIME_RECONNECT_MAX_MS);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function drainPendingOperations(
  pendingOperations: ReadonlySet<Promise<unknown>>,
): Promise<void> {
  while (pendingOperations.size > 0) {
    await Promise.allSettled([...pendingOperations]);
  }
}

async function wakeMessaging(): Promise<void> {
  try {
    await wakeActiveMessagingSession();
  } catch (error) {
    reportSocialRuntimeError('social-realtime-wake', error);
    throw error;
  }
}

function reportSocialRuntimeError(operation: string, error: unknown): void {
  window.dispatchEvent(new CustomEvent(MOBILE_MESSAGING_RUNTIME_ERROR_EVENT, {
    detail: {
      operation,
      message: readableErrorMessage(error),
    },
  }));
}
