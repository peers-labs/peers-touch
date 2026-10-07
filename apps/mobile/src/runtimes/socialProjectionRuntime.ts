import {
  socialHostEventTargetsNotifications,
  type SocialHostEvent,
} from '@peers-touch/client-chat-core';

import type { MobileAuthSession } from '../features/auth/authSession';
import { mobileAuthScopeKey } from '../features/auth/mobileAuthIdentity';
import type { SocialState } from '../features/social/socialStore';
import {
  createMomentsFeedStore,
  type MomentsFeedStoreController,
} from '../features/social/momentsFeedStore';
import type { RealtimeWireEvent } from '../features/social/socialWire';
import {
  createMomentsGateway,
  type MomentsGateway,
} from '../services/gateways/momentsGateway';
import {
  createNotificationPreferenceGateway,
  createProfileGateway,
  type NotificationPreferenceGateway,
  type ProfileGateway,
} from '../services/gateways/profileGateway';
import {
  createMomentsProjection,
  type MomentsProjectionController,
} from './momentsProjectionDescriptor';
import {
  createNotificationPreferenceProjection,
  createProfileProjection,
  type NotificationPreferenceProjectionController,
  type ProfileProjectionController,
} from './profileProjectionDescriptor';
import { bindMobileMutationAdmission } from './mutationAdmission';
import { getRecoveryProjection } from './recoveryProjection';
import {
  createSocialEventIngress,
  type ControlEvent,
  type IngressReconcileRequest,
  type MomentsDataEvent,
  type NotificationDataEvent,
  type ProfileDataEvent,
  type SocialDataEvent,
  type SocialEventIngressController,
  type SocialIngressDomain,
  type SocialIngressEvent,
} from './socialEventIngress';

export type ProjectionDomain = Exclude<SocialIngressDomain, 'control'>;

const PROJECTION_DOMAINS: readonly ProjectionDomain[] = [
  'social',
  'moments',
  'notification',
  'profile',
];

const BOOTSTRAP_DOMAINS: readonly ProjectionDomain[] = [
  'social',
  'moments',
  'notification',
  'profile',
];

export interface ActiveMomentsRuntime {
  readonly gateway: MomentsGateway;
  readonly feed: MomentsFeedStoreController;
  readonly projection: MomentsProjectionController;
  readonly retry: () => Promise<boolean>;
}

export interface ActiveProfileRuntime {
  readonly gateway: ProfileGateway;
  readonly projection: ProfileProjectionController;
  readonly notificationGateway: NotificationPreferenceGateway;
  readonly notificationPreferences: Pick<
    NotificationPreferenceProjectionController,
    'state' | 'subscribe'
  >;
  readonly refreshNotificationPreferences:
    NotificationPreferenceProjectionController['reconcile'];
  readonly updateNotificationPreferences:
    NotificationPreferenceProjectionController['updatePreferences'];
}

export interface SocialProjectionRuntimeDependencies {
  readonly wakeMessaging: () => Promise<void>;
  readonly revalidateSession: () => Promise<void>;
  readonly ingestCallSignal: (
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
  ) => void;
  readonly reportError: (operation: string, error: unknown) => void;
}

export interface SocialProjectionRuntimeController {
  readonly ingress: SocialEventIngressController;
  readonly moments: ActiveMomentsRuntime;
  readonly profile: ActiveProfileRuntime;
  bootstrap(): Promise<void>;
  requestCurrentUserProfile(force?: boolean): Promise<void>;
  requestPeerProfiles(peerPtids: readonly string[], force?: boolean): Promise<void>;
  requestFriendshipStatus(targetPtid: string): Promise<void>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  reconcile(reason: string, domains?: readonly ProjectionDomain[]): Promise<void>;
  ingestRealtimeEvent(event: RealtimeWireEvent): void;
  dispatchExternalEvent(event: SocialHostEvent): void;
  drain(): Promise<void>;
  teardown(): Promise<void>;
}

interface ActiveRuntimeProjection {
  readonly sessionKey: string;
  readonly moments: ActiveMomentsRuntime;
  readonly profile: ActiveProfileRuntime;
  readonly ingress: SocialEventIngressController;
}

let activeRuntime: ActiveRuntimeProjection | null = null;

export function readActiveMomentsRuntime(
  session: MobileAuthSession | null,
): ActiveMomentsRuntime | null {
  if (!session || activeRuntime?.sessionKey !== mobileAuthScopeKey(session)) return null;
  return activeRuntime.moments;
}

export function readCurrentActiveMomentsRuntime(): ActiveMomentsRuntime | null {
  return activeRuntime?.moments ?? null;
}

export function readActiveProfileRuntime(
  session: MobileAuthSession | null,
): ActiveProfileRuntime | null {
  if (!session || activeRuntime?.sessionKey !== mobileAuthScopeKey(session)) return null;
  return activeRuntime.profile;
}

export function readCurrentActiveProfileRuntime(): ActiveProfileRuntime | null {
  return activeRuntime?.profile ?? null;
}

export function readActiveSocialIngressState() {
  return activeRuntime?.ingress.state() ?? null;
}

export function createSocialProjectionRuntime(
  session: MobileAuthSession,
  getSocialStore: () => SocialState,
  dependencies: SocialProjectionRuntimeDependencies,
): SocialProjectionRuntimeController {
  const sessionKey = mobileAuthScopeKey(session);
  const momentsGateway = createMomentsGateway(session);
  const momentsProjection = createMomentsProjection();
  const momentsFeed = createMomentsFeedStore(momentsGateway);
  const profileGateway = createProfileGateway(session);
  const profileProjection = createProfileProjection(profileGateway);
  const notificationPreferenceGateway = createNotificationPreferenceGateway(session);
  const notificationPreferenceProjection = createNotificationPreferenceProjection(
    notificationPreferenceGateway,
  );
  const recovery = getRecoveryProjection();
  let torn = false;
  let releaseMutationAdmission: (() => void) | null = null;
  let reconcileTail: Promise<void> = Promise.resolve();

  const moments: ActiveMomentsRuntime = {
    gateway: momentsGateway,
    feed: momentsFeed,
    projection: momentsProjection,
    retry: async () => {
      await scheduleReconcile(
        ['moments'],
        'user-retry',
        ingress.state().streamCursor,
      );
      return momentsProjection.state().availability.available;
    },
  };
  const profile: ActiveProfileRuntime = {
    gateway: profileGateway,
    projection: profileProjection,
    notificationGateway: notificationPreferenceGateway,
    notificationPreferences: notificationPreferenceProjection,
    refreshNotificationPreferences: notificationPreferenceProjection.reconcile,
    updateNotificationPreferences: notificationPreferenceProjection.updatePreferences,
  };

  const ingress = createSocialEventIngress({
    onEvent: routeIngressEvent,
    onAdmissionChange: (admission) => recovery.reportWriteAdmission(admission),
    onStaleness: () => recovery.reportIngressState(ingress.state()),
    onReconcileRequired: enqueueReconcile,
    onSessionRevalidationRequired: enqueueSessionRevalidation,
    onHandlerError: (event, error) => {
      dependencies.reportError(`ingress:${event.domain}:${event.kind}`, error);
    },
  });

  function enqueueReconcile(request: IngressReconcileRequest): void {
    void scheduleReconcile(
      projectionDomains(request.domains),
      request.reason,
      request.checkpointCursor,
    );
  }

  function enqueueSessionRevalidation(reason: string): void {
    reconcileTail = reconcileTail
      .then(async () => {
        if (torn) return;
        await dependencies.revalidateSession();
      })
      .catch((error) => dependencies.reportError(`session-revalidate:${reason}`, error));
  }

  function scheduleReconcile(
    domains: readonly ProjectionDomain[],
    reason: string,
    checkpointCursor: string,
  ): Promise<void> {
    const operation = reconcileTail.then(
      () => reconcileDomains(domains, reason, checkpointCursor),
    );
    reconcileTail = operation.catch(
      (error) => dependencies.reportError(`reconcile:${reason}`, error),
    );
    return operation;
  }

  async function reconcileDomains(
    domains: readonly ProjectionDomain[],
    reason: string,
    checkpointCursor: string,
  ): Promise<void> {
    if (torn) return;
    const uniqueDomains = [...new Set(domains)];
    const results = await Promise.all(uniqueDomains.map(async (domain) => {
      try {
        if (!await reconcileDomain(domain)) return false;
        if (!torn) ingress.repairCursor(domain, checkpointCursor);
        return true;
      } catch (error) {
        if (!torn) {
          ingress.markStale(
            domain,
            `${reason}:reconcile_failed`,
            checkpointCursor,
            false,
          );
          if (domain === 'moments') momentsProjection.markUnavailable(readableError(error));
          if (domain === 'profile') profileProjection.markUnavailable(readableError(error));
          dependencies.reportError(`reconcile:${domain}:${reason}`, error);
        }
        return false;
      }
    }));
    let messagingReady = true;
    if (!torn && shouldReconcileMessaging(reason)) {
      try {
        await dependencies.wakeMessaging();
      } catch (error) {
        messagingReady = false;
        dependencies.reportError(`reconcile:messaging:${reason}`, error);
      }
    }
    if (!torn && messagingReady && results.every(Boolean)) {
      ingress.reopenAdmission();
    }
    if (!torn) recovery.reportIngressState(ingress.state());
  }

  async function reconcileDomain(domain: ProjectionDomain): Promise<boolean> {
    const socialStore = getSocialStore();
    switch (domain) {
      case 'social':
        await socialStore.reconcile();
        if (getSocialStore().error) throw getSocialStore().error;
        return true;
      case 'moments': {
        const reconciled = await momentsFeed.reconcile();
        if (reconciled === null || torn) return false;
        if (!reconciled) {
          throw new Error(momentsFeed.state().errorMessage || 'mobile.moments.unavailable');
        }
        momentsProjection.markAvailable();
        return true;
      }
      case 'notification':
        await Promise.all([
          socialStore.refreshNotifications(),
          reconcileNotificationPreferences(),
        ]);
        return true;
      case 'profile': {
        const profileResult = await profileProjection.reconcile();
        if (!profileResult.ok) throw new Error(profileResult.error.message);
        await socialStore.loadCurrentUserProfile(true);
        return true;
      }
    }
  }

  async function routeIngressEvent(event: SocialIngressEvent): Promise<void> {
    if (torn) return;
    const socialStore = getSocialStore();
    switch (event.domain) {
      case 'social':
        await routeSocialEvent(event);
        return;
      case 'moments':
        momentsProjection.ingestEvent(event);
        if (event.kind === 'post-deleted' && event.postId) {
          momentsFeed.removePost(event.postId);
        }
        await scheduleReconcile(['moments'], event.kind, event.cursor);
        return;
      case 'notification':
        await socialStore.refreshNotifications();
        return;
      case 'profile':
        if (event.kind === 'preference-changed') {
          await reconcileNotificationPreferences();
          return;
        }
        profileProjection.ingestEvent(event);
        await reconcileProfileEvent(event);
        return;
      case 'control':
        if (event.kind === 'session-revalidate') {
          await dependencies.revalidateSession();
        } else if (
          event.kind === 'messaging-wake'
          || event.kind === 'resync-required'
        ) {
          await dependencies.wakeMessaging();
        }
    }
  }

  async function routeSocialEvent(event: SocialDataEvent): Promise<void> {
    const socialStore = getSocialStore();
    switch (event.kind) {
      case 'friend-typing':
        socialStore.applyTypingState(
          requireString(event.payload, 'sessionUlid'),
          requireString(event.payload, 'fromActorPtid'),
          requireBoolean(event.payload, 'typing'),
        );
        return;
      case 'friend-presence':
        socialStore.setPeerOnline(
          requireString(event.payload, 'actorPtid'),
          requireBoolean(event.payload, 'online'),
        );
        return;
      case 'friend-request':
        await Promise.all([
          socialStore.refreshFriendRequests(),
          socialStore.refreshNotifications(),
        ]);
        return;
      case 'relationship-changed': {
        const actorPtid = optionalString(event.payload.actorPtid);
        const targetPtid = optionalString(event.payload.targetPtid);
        const currentPtid = socialStore.currentUserPtid;
        const peerPtid = actorPtid === currentPtid ? targetPtid : actorPtid;
        await Promise.all([
          socialStore.refreshBlockedUsers(),
          socialStore.refreshFriendRequests(),
          peerPtid
            ? socialStore.loadFriendshipStatus(peerPtid)
            : Promise.resolve(),
        ]);
        await dependencies.wakeMessaging();
        return;
      }
    }
  }

  async function reconcileProfileEvent(event: ProfileDataEvent): Promise<void> {
    const socialStore = getSocialStore();
    const ptids = new Set<string>();
    if (event.actorPtid) ptids.add(event.actorPtid);
    const targetPtid = optionalString(event.payload.targetPtid);
    if (targetPtid) ptids.add(targetPtid);
    const currentUserPtid = socialStore.currentUserPtid;
    const refreshCurrentProfile = Boolean(
      currentUserPtid && ptids.delete(currentUserPtid),
    );
    await Promise.allSettled(
      [...ptids].map((ptid) => socialStore.loadPeerProfile(ptid, true)),
    );
    if (!refreshCurrentProfile) return;
    const result = await profileProjection.reconcile();
    if (!result.ok) throw new Error(result.error.message);
    await socialStore.loadCurrentUserProfile(true);
  }

  async function reconcileNotificationPreferences(): Promise<void> {
    const result = await notificationPreferenceProjection.reconcile();
    if (!result.ok) throw new Error(result.error.message);
  }

  function ingestRealtimeEvent(event: RealtimeWireEvent): void {
    if (event.kind === 'call-signal') {
      dependencies.ingestCallSignal(event);
      return;
    }
    toIngressEvents(event).forEach((ingressEvent) => {
      if (ingressEvent.domain === 'control') {
        ingress.ingestControlEvent(ingressEvent);
      } else {
        ingress.ingestDataEvent(ingressEvent);
      }
    });
  }

  function dispatchExternalEvent(event: SocialHostEvent): void {
    const timestampMs = Date.now();
    if (socialHostEventTargetsNotifications(event)) {
      ingress.ingestDataEvent({
        domain: 'notification',
        kind: 'notification-received',
        notificationId: event.notificationId,
        payload: { reason: event.reason ?? event.kind },
        cursor: '',
        timestampMs,
      });
    }
    ingress.ingestControlEvent({
      domain: 'control',
      kind: event.kind === 'app-resume' || event.kind === 'network-online'
        ? 'resync-required'
        : 'host-wakeup',
      payload: { reason: event.reason ?? event.kind },
      cursor: '',
      timestampMs,
    });
  }

  const publicRuntime: ActiveRuntimeProjection = {
    sessionKey,
    moments,
    profile,
    ingress,
  };

  return {
    ingress,
    moments,
    profile,
    async bootstrap(): Promise<void> {
      if (activeRuntime && activeRuntime !== publicRuntime) {
        throw new Error('mobile.social.projectionRuntimeAlreadyActive');
      }
      releaseMutationAdmission ??= bindMobileMutationAdmission(
        sessionKey,
        () => ingress.state(),
      );
      activeRuntime = publicRuntime;
      await scheduleReconcile(BOOTSTRAP_DOMAINS, 'bootstrap', '');
    },
    async requestCurrentUserProfile(force = false): Promise<void> {
      await getSocialStore().loadCurrentUserProfile(force);
    },
    async requestPeerProfiles(
      peerPtids: readonly string[],
      force = false,
    ): Promise<void> {
      const uniquePtids = [...new Set(
        peerPtids.map((ptid) => ptid.trim()).filter(Boolean),
      )];
      await Promise.allSettled(
        uniquePtids.map((ptid) => getSocialStore().loadPeerProfile(ptid, force)),
      );
    },
    async requestFriendshipStatus(targetPtid: string): Promise<void> {
      const ptid = targetPtid.trim();
      if (!ptid) return;
      await getSocialStore().loadFriendshipStatus(ptid);
    },
    async suspend(): Promise<void> {
      ingress.suspend();
      await ingress.drain();
      await reconcileTail;
    },
    async resume(): Promise<void> {
      ingress.resume();
      await reconcileTail;
      recovery.reportIngressState(ingress.state());
    },
    async reconcile(
      reason: string,
      domains: readonly ProjectionDomain[] = PROJECTION_DOMAINS,
    ): Promise<void> {
      await scheduleReconcile(domains, reason, ingress.state().streamCursor);
    },
    ingestRealtimeEvent,
    dispatchExternalEvent,
    async drain(): Promise<void> {
      await ingress.drain();
      await reconcileTail;
      await getSocialStore().drainProfileCacheWrites();
    },
    async teardown(): Promise<void> {
      if (torn) return;
      torn = true;
      ingress.teardown();
      await ingress.drain();
      await reconcileTail;
      await getSocialStore().drainProfileCacheWrites();
      momentsFeed.teardown();
      momentsProjection.teardown();
      notificationPreferenceProjection.teardown();
      profileProjection.teardown();
      if (activeRuntime === publicRuntime) activeRuntime = null;
      releaseMutationAdmission?.();
      releaseMutationAdmission = null;
    },
  };
}

function shouldReconcileMessaging(reason: string): boolean {
  return reason === 'control_event_lost'
    || reason === 'cursor-repair'
    || reason === 'explicit-request'
    || reason === 'host-wakeup'
    || reason === 'resync-required'
    || reason === 'runtime_resume'
    || reason === 'stream-reconnect';
}

function projectionDomains(
  domains: readonly SocialIngressDomain[],
): ProjectionDomain[] {
  if (domains.includes('control')) return [...PROJECTION_DOMAINS];
  return domains.filter((domain): domain is ProjectionDomain => domain !== 'control');
}

function toIngressEvents(event: RealtimeWireEvent): SocialIngressEvent[] {
  const base = {
    cursor: event.cursor,
    timestampMs: event.timestampMs,
  };
  switch (event.kind) {
    case 'heartbeat':
      return [{
        ...base,
        domain: 'control',
        kind: 'heartbeat',
        payload: { floorEventId: event.floorEventId },
      }];
    case 'messaging-wake':
      return [{
        ...base,
        domain: 'control',
        kind: 'messaging-wake',
        payload: { conversationId: event.conversationId },
      }];
    case 'typing':
      return [{
        ...base,
        domain: 'social',
        kind: 'friend-typing',
        sessionUlid: event.sessionUlid,
        payload: {
          sessionUlid: event.sessionUlid,
          fromActorPtid: event.fromActorPtid,
          typing: event.typing,
        },
      }];
    case 'presence':
      return [{
        ...base,
        domain: 'social',
        kind: 'friend-presence',
        payload: {
          actorPtid: event.ptid,
          online: event.online,
        },
      }];
    case 'settings-changed':
      return [{
        ...base,
        domain: 'control',
        kind: 'messaging-wake',
        payload: { conversationId: event.containerUlid },
      }];
    case 'moment': {
      const momentsEvent: MomentsDataEvent = {
        ...base,
        domain: 'moments',
        kind: event.momentKind,
        postId: event.postId,
        payload: {
          authorActorPtid: event.authorActorPtid,
          actorPtid: event.actorPtid,
          commentId: event.commentId,
          reactionKind: event.reactionKind,
          removed: event.removed,
          audience: event.audience,
        },
      };
      const notificationEvent: NotificationDataEvent = {
        ...base,
        domain: 'notification',
        kind: 'notification-received',
        payload: { source: 'moment', postId: event.postId },
      };
      return [momentsEvent, notificationEvent];
    }
    case 'social-graph': {
      const friendRequestEvent = event.graphKind.startsWith('friend-request');
      const socialEvent: SocialDataEvent = {
        ...base,
        domain: 'social',
        kind: friendRequestEvent ? 'friend-request' : 'relationship-changed',
        sessionUlid: event.conversationId || undefined,
        payload: {
          graphKind: event.graphKind,
          actorPtid: event.actorPtid,
          targetPtid: event.targetPtid,
          requestId: event.requestId,
        },
      };
      const notificationEvent: NotificationDataEvent = {
        ...base,
        domain: 'notification',
        kind: 'notification-received',
        payload: { source: 'social-graph', graphKind: event.graphKind },
      };
      const profileEvent: ProfileDataEvent = {
        ...base,
        domain: 'profile',
        kind: 'relationship-changed',
        actorPtid: event.actorPtid,
        payload: { targetPtid: event.targetPtid },
      };
      const wakeMessagingEvent: ControlEvent | null =
        event.graphKind === 'friend-request-accepted'
          ? {
              ...base,
              domain: 'control',
              kind: 'messaging-wake',
              payload: { conversationId: event.conversationId },
            }
          : null;
      return wakeMessagingEvent
        ? [socialEvent, notificationEvent, profileEvent, wakeMessagingEvent]
        : [socialEvent, notificationEvent, profileEvent];
    }
    case 'resync':
      return [{
        ...base,
        domain: 'control',
        kind: 'resync-required',
        payload: {
          newestEventId: event.newestEventId,
          reason: event.reason,
        },
      }];
    case 'call-signal':
      return [];
  }
}

function requireString(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`mobile.social.invalidIngressPayload:${key}`);
  }
  return value;
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function requireBoolean(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw new Error(`mobile.social.invalidIngressPayload:${key}`);
  }
  return value;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
