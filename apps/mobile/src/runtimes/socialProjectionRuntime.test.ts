// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayMocks = vi.hoisted(() => ({
  fetchFeed: vi.fn(),
  getPost: vi.fn(),
  fetchComments: vi.fn(),
  getCurrentProfile: vi.fn(),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

vi.mock('../services/gateways/momentsGateway', () => ({
  createMomentsGateway: () => ({
    fetchFeed: gatewayMocks.fetchFeed,
    getPost: gatewayMocks.getPost,
    fetchComments: gatewayMocks.fetchComments,
  }),
}));

vi.mock('../services/gateways/profileGateway', () => ({
  createProfileGateway: () => ({
    getCurrentProfile: gatewayMocks.getCurrentProfile,
  }),
  createNotificationPreferenceGateway: () => ({
    getNotificationPreferences: gatewayMocks.getNotificationPreferences,
    updateNotificationPreferences: gatewayMocks.updateNotificationPreferences,
  }),
}));

import {
  createSocialProjectionRuntime,
  readActiveMomentsRuntime,
  readActiveProfileRuntime,
  readActiveSocialIngressState,
} from './socialProjectionRuntime';
import {
  bindMobileSessionMutationAdmission,
  requireMobileMutationAdmission,
} from './mutationAdmission';
import { PostDetailOutcome } from '../gen/proto/domain/social/post_pb';

const session = {
  stationPeerId: 'station-primary',
  stationUrl: 'https://station.example',
  sessionId: 'session-1',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};
let releaseSessionAdmission: (() => void) | null = null;

describe('social projection runtime', () => {
  beforeEach(() => {
    releaseSessionAdmission?.();
    releaseSessionAdmission = bindMobileSessionMutationAdmission(() => ({
      scopeKey: 'station-primary|ptid:alice',
      open: true,
      reason: 'session_active',
    }));
    gatewayMocks.fetchFeed.mockReset().mockResolvedValue({
      ok: true,
      data: {
        posts: [],
        nextCursor: '',
        hasMore: false,
      },
    });
    gatewayMocks.getPost.mockReset().mockResolvedValue({
      ok: true,
      data: {
        outcome: PostDetailOutcome.AVAILABLE,
        post: {
          id: 'post-1',
          reactions: [],
        },
        explanation: { objectId: 'post-1' },
      },
    });
    gatewayMocks.fetchComments.mockReset().mockResolvedValue({
      ok: true,
      data: {
        comments: [],
        nextCursor: '',
        hasMore: false,
      },
    });
    gatewayMocks.getCurrentProfile.mockReset().mockResolvedValue({
      ok: true,
      data: {
        id: 'ptid:alice',
        ptid: 'ptid:alice',
        displayName: 'Alice',
        username: 'alice',
        note: '',
        avatar: '',
        header: '',
        region: '',
        timezone: '',
        statusesCount: 0,
      },
    });
    gatewayMocks.getNotificationPreferences.mockReset().mockResolvedValue({
      ok: true,
      data: {
        preferences: [],
        notificationPreferencesRevision: 1n,
      },
    });
    gatewayMocks.updateNotificationPreferences.mockReset();
  });

  afterEach(() => {
    releaseSessionAdmission?.();
    releaseSessionAdmission = null;
  });

  it('owns bootstrap, domain routing, resume reconciliation, and teardown', async () => {
    const socialStore = {
      error: null,
      currentUserPtid: 'ptid:alice',
      reconcile: vi.fn(async () => undefined),
      refreshNotifications: vi.fn(async () => undefined),
      refreshFriendRequests: vi.fn(async () => undefined),
      refreshBlockedUsers: vi.fn(async () => undefined),
      refreshSessions: vi.fn(async () => undefined),
      loadConversationSettings: vi.fn(async () => undefined),
      drainProfileCacheWrites: vi.fn(async () => undefined),
      loadCurrentUserProfile: vi.fn(async () => undefined),
      loadPeerProfile: vi.fn(async () => undefined),
      loadFriendshipStatus: vi.fn(async () => undefined),
      applyTypingState: vi.fn(),
      setPeerOnline: vi.fn(),
    };
    const wakeMessaging = vi.fn(async () => undefined);
    const revalidateSession = vi.fn(async () => undefined);
    const ingestCallSignal = vi.fn();
    const reportError = vi.fn();
    const runtime = createSocialProjectionRuntime(
      session,
      () => socialStore,
      {
        wakeMessaging,
        revalidateSession,
        ingestCallSignal,
        reportError,
      },
    );

    await runtime.bootstrap();

    expect(readActiveMomentsRuntime(session)).toBe(runtime.moments);
    expect(readActiveProfileRuntime(session)).toBe(runtime.profile);
    expect(socialStore.reconcile).toHaveBeenCalledOnce();
    expect(gatewayMocks.fetchFeed).toHaveBeenCalledOnce();
    expect(gatewayMocks.getCurrentProfile).toHaveBeenCalledOnce();
    expect(gatewayMocks.getNotificationPreferences).toHaveBeenCalledOnce();
    expect(runtime.profile.projection.state()).toMatchObject({
      availability: { available: true },
    });
    expect(runtime.profile.notificationPreferences.state()).toMatchObject({
      availability: { available: true },
      snapshot: {
        preferences: [],
        notificationPreferencesRevision: 1n,
      },
    });
    expect(() => requireMobileMutationAdmission(
      'station-primary|ptid:alice',
      'social',
    )).not.toThrow();

    await runtime.requestCurrentUserProfile(true);
    await runtime.requestPeerProfiles(['ptid:bob', 'ptid:bob'], true);
    await runtime.requestFriendshipStatus('ptid:bob');
    expect(socialStore.loadCurrentUserProfile).toHaveBeenCalledWith(true);
    expect(socialStore.loadPeerProfile).toHaveBeenCalledWith('ptid:bob', true);
    expect(socialStore.loadPeerProfile).toHaveBeenCalledTimes(1);
    expect(socialStore.loadFriendshipStatus).toHaveBeenCalledWith('ptid:bob');

    await runtime.moments.feed.ensureMoment('post-1');
    expect(gatewayMocks.getPost).toHaveBeenCalledOnce();
    expect(gatewayMocks.fetchComments).toHaveBeenCalledOnce();
    gatewayMocks.getPost
      .mockResolvedValueOnce({
        ok: true,
        data: {
          outcome: PostDetailOutcome.AVAILABLE,
          post: { id: 'post-1', reactions: [] },
          explanation: { objectId: 'post-1' },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { outcome: PostDetailOutcome.DELETED },
      });

    await runtime.reconcile('group-bootstrap', ['group']);
    expect(wakeMessaging).toHaveBeenCalledOnce();

    runtime.ingestRealtimeEvent({
      kind: 'call-signal',
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:bob',
      signalKind: 'CALL_REQUEST',
      callId: '01K5TCALL00000000000000000',
      winningDeviceId: '',
      payload: new Uint8Array([1, 2, 3]),
      cursor: 'cursor-call',
      timestampMs: 9,
    });
    runtime.ingestRealtimeEvent({
      kind: 'moment',
      momentKind: 'post-commented',
      postId: 'post-1',
      authorActorPtid: 'ptid:bob',
      actorPtid: 'ptid:alice',
      commentId: 'comment-1',
      reactionKind: '',
      removed: false,
      audience: 'friends',
      cursor: 'cursor-1',
      timestampMs: 10,
    });
    runtime.ingestRealtimeEvent({
      kind: 'moment',
      momentKind: 'post-deleted',
      postId: 'post-1',
      authorActorPtid: 'ptid:bob',
      actorPtid: 'ptid:alice',
      commentId: '',
      reactionKind: '',
      removed: false,
      audience: 'friends',
      cursor: 'cursor-1-delete',
      timestampMs: 11,
    });
    runtime.ingestRealtimeEvent({
      kind: 'social-graph',
      graphKind: 'friend-request-received',
      actorPtid: 'ptid:bob',
      targetPtid: 'ptid:alice',
      requestId: 'request-1',
      conversationId: '',
      cursor: 'cursor-2',
      timestampMs: 12,
    });
    runtime.ingestRealtimeEvent({
      kind: 'social-graph',
      graphKind: 'relationship-blocked',
      actorPtid: 'ptid:bob',
      targetPtid: 'ptid:alice',
      requestId: '',
      conversationId: '',
      cursor: 'cursor-3',
      timestampMs: 13,
    });
    await runtime.drain();

    expect(gatewayMocks.fetchFeed).toHaveBeenCalledTimes(3);
    expect(gatewayMocks.getPost).toHaveBeenCalledTimes(3);
    expect(gatewayMocks.fetchComments).toHaveBeenCalledTimes(2);
    expect(runtime.moments.feed.state().selectedDetail).toMatchObject({
      postId: 'post-1',
      readback: {
        kind: 'deleted',
      },
    });
    expect(socialStore.refreshFriendRequests).toHaveBeenCalled();
    expect(socialStore.refreshBlockedUsers).toHaveBeenCalled();
    expect(socialStore.loadFriendshipStatus).toHaveBeenCalledWith('ptid:bob');
    expect(socialStore.refreshNotifications).toHaveBeenCalled();
    expect(socialStore.loadPeerProfile).toHaveBeenCalledWith('ptid:bob', true);
    expect(ingestCallSignal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'call-signal',
      callId: '01K5TCALL00000000000000000',
    }));
    expect(readActiveSocialIngressState()?.streamCursor).toBe('cursor-3');

    await runtime.suspend();
    expect(readActiveSocialIngressState()).toMatchObject({
      lifecycle: 'suspended',
      writeAdmission: {
        open: false,
        reason: 'runtime_suspended',
      },
    });
    expect(() => requireMobileMutationAdmission(
      'station-primary|ptid:alice',
      'social',
    )).toThrowError(expect.objectContaining({ reason: 'runtime_suspended' }));

    await runtime.resume();
    expect(readActiveSocialIngressState()).toMatchObject({
      lifecycle: 'active',
      writeAdmission: { open: true },
    });
    expect(() => requireMobileMutationAdmission(
      'station-primary|ptid:alice',
      'social',
    )).not.toThrow();

    await runtime.teardown();
    expect(socialStore.drainProfileCacheWrites).toHaveBeenCalled();
    expect(readActiveMomentsRuntime(session)).toBeNull();
    expect(readActiveProfileRuntime(session)).toBeNull();
    expect(readActiveSocialIngressState()).toBeNull();
    expect(() => requireMobileMutationAdmission(
      'station-primary|ptid:alice',
      'social',
    )).toThrowError(expect.objectContaining({ reason: 'runtime_unavailable' }));
    expect(reportError).not.toHaveBeenCalled();
  });

  it('does not make Profile unavailable when Notification preferences fail', async () => {
    gatewayMocks.getNotificationPreferences.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'notification preferences unavailable',
        method: 'GET',
        path: '/notification/preferences',
      },
    });
    const socialStore = {
      error: null,
      currentUserPtid: 'ptid:alice',
      reconcile: vi.fn(async () => undefined),
      refreshNotifications: vi.fn(async () => undefined),
      refreshFriendRequests: vi.fn(async () => undefined),
      refreshSessions: vi.fn(async () => undefined),
      loadConversationSettings: vi.fn(async () => undefined),
      drainProfileCacheWrites: vi.fn(async () => undefined),
      loadCurrentUserProfile: vi.fn(async () => undefined),
      loadPeerProfile: vi.fn(async () => undefined),
      loadFriendshipStatus: vi.fn(async () => undefined),
      applyTypingState: vi.fn(),
      setPeerOnline: vi.fn(),
    };
    const reportError = vi.fn();
    const runtime = createSocialProjectionRuntime(
      session,
      () => socialStore,
      {
        wakeMessaging: vi.fn(async () => undefined),
        revalidateSession: vi.fn(async () => undefined),
        ingestCallSignal: vi.fn(),
        reportError,
      },
    );

    await runtime.bootstrap();

    expect(runtime.profile.projection.state()).toMatchObject({
      availability: { available: true },
    });
    expect(runtime.profile.notificationPreferences.state()).toMatchObject({
      availability: { available: false },
    });
    expect(reportError).toHaveBeenCalledWith(
      'reconcile:notification:bootstrap',
      expect.any(Error),
    );
    expect(reportError).not.toHaveBeenCalledWith(
      'reconcile:profile:bootstrap',
      expect.anything(),
    );

    await runtime.teardown();
  });

  it('keeps Moments unavailable until a runtime-owned retry succeeds', async () => {
    const socialStore = {
      error: null,
      currentUserPtid: 'ptid:alice',
      reconcile: vi.fn(async () => undefined),
      refreshNotifications: vi.fn(async () => undefined),
      refreshFriendRequests: vi.fn(async () => undefined),
      refreshSessions: vi.fn(async () => undefined),
      loadConversationSettings: vi.fn(async () => undefined),
      drainProfileCacheWrites: vi.fn(async () => undefined),
      loadCurrentUserProfile: vi.fn(async () => undefined),
      loadPeerProfile: vi.fn(async () => undefined),
      loadFriendshipStatus: vi.fn(async () => undefined),
      applyTypingState: vi.fn(),
      setPeerOnline: vi.fn(),
    };
    const runtime = createSocialProjectionRuntime(
      session,
      () => socialStore,
      {
        wakeMessaging: vi.fn(async () => undefined),
        revalidateSession: vi.fn(async () => undefined),
        ingestCallSignal: vi.fn(),
        reportError: vi.fn(),
      },
    );
    await runtime.bootstrap();

    await runtime.moments.feed.ensureMoment('post-1');
    gatewayMocks.getPost.mockResolvedValueOnce({
      ok: false,
      error: { message: 'detail offline' },
    });
    await expect(runtime.moments.retry()).resolves.toBe(false);
    expect(runtime.moments.projection.state().availability).toEqual({
      available: false,
      reason: 'mobile.moments.unavailable',
    });

    gatewayMocks.getPost.mockResolvedValueOnce({
      ok: true,
      data: {
        outcome: PostDetailOutcome.AVAILABLE,
        post: { id: 'post-1', reactions: [] },
        explanation: { objectId: 'post-1' },
      },
    });
    await expect(runtime.moments.retry()).resolves.toBe(true);
    expect(runtime.moments.projection.state().availability).toEqual({
      available: true,
    });

    await runtime.teardown();
  });

  it('does not change availability or acknowledge freshness for superseded reconciliation', async () => {
    const runtime = createSocialProjectionRuntime(
      session,
      () => ({
        error: null,
        reconcile: async () => undefined,
        refreshNotifications: async () => undefined,
        loadCurrentUserProfile: async () => undefined,
        drainProfileCacheWrites: async () => undefined,
      }),
      {
        wakeMessaging: async () => undefined,
        revalidateSession: async () => undefined,
        ingestCallSignal: vi.fn(),
        reportError: vi.fn(),
      },
    );
    await runtime.bootstrap();
    try {
      const repairCursor = vi.spyOn(runtime.ingress, 'repairCursor');
      const reopenAdmission = vi.spyOn(runtime.ingress, 'reopenAdmission');
      vi.spyOn(runtime.moments.feed, 'reconcile').mockResolvedValue(null);

      await runtime.reconcile('navigation', ['moments']);
      expect(runtime.moments.projection.state().availability).toEqual({ available: true });
      expect(repairCursor).not.toHaveBeenCalled();
      expect(reopenAdmission).not.toHaveBeenCalled();
      expect(() => requireMobileMutationAdmission('station-primary|ptid:alice', 'moments'))
        .not.toThrow();

      runtime.ingress.markStale('moments', 'lost-event', 'cursor-1', false);
      runtime.moments.projection.markUnavailable('offline');
      await expect(runtime.moments.retry()).resolves.toBe(false);
      expect(runtime.moments.projection.state().availability).toEqual({
        available: false, reason: 'offline',
      });
      expect(runtime.ingress.state().staleness.moments.stale).toBe(true);
      expect(repairCursor).not.toHaveBeenCalled();
    } finally {
      await runtime.teardown();
    }
  });
});
