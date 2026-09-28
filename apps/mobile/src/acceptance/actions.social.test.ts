// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const socialMocks = vi.hoisted(() => ({
  readFederationContexts: vi.fn(),
  readCurrentSocialProfile: vi.fn(),
  searchSocialPeople: vi.fn(),
  updateCurrentSocialProfile: vi.fn(),
}));
const projectionMocks = vi.hoisted(() => ({
  readCurrentActiveMomentsRuntime: vi.fn(),
  readCurrentActiveProfileRuntime: vi.fn(),
}));
const deviceMocks = vi.hoisted(() => ({
  loadDevicePreferences: vi.fn(),
  persistDevicePreferences: vi.fn(),
  readDeviceSettingsRuntimeSnapshot: vi.fn(),
}));

vi.mock('../features/social/socialRuntime', () => ({
  acceptSocialFriendRequest: vi.fn(),
  applySocialFriendRequestProjectionCheckpoints: vi.fn(),
  readFederationContexts: socialMocks.readFederationContexts,
  readSocialRuntimeProjection: vi.fn(),
  readCurrentSocialProfile: socialMocks.readCurrentSocialProfile,
  reconcileSocialRuntime: vi.fn(),
  searchSocialPeople: socialMocks.searchSocialPeople,
  sendSocialFriendRequest: vi.fn(),
  submitSocialFriendRequest: vi.fn(),
  updateCurrentSocialProfile: socialMocks.updateCurrentSocialProfile,
}));

vi.mock('../runtimes/socialProjectionRuntime', () => ({
  readCurrentActiveMomentsRuntime:
    projectionMocks.readCurrentActiveMomentsRuntime,
  readCurrentActiveProfileRuntime:
    projectionMocks.readCurrentActiveProfileRuntime,
}));

vi.mock('../runtimes/deviceSettingsRuntime', () => ({
  loadDevicePreferences: deviceMocks.loadDevicePreferences,
  persistDevicePreferences: deviceMocks.persistDevicePreferences,
  readDeviceSettingsRuntimeSnapshot:
    deviceMocks.readDeviceSettingsRuntimeSnapshot,
}));

import { mobileAcceptanceActions } from './actions';

describe('Mobile Acceptance social actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('binds people search results to an authoritative Federation context', async () => {
    socialMocks.searchSocialPeople.mockResolvedValue([{
      ptid: 'ptid:bob',
      homeStationPeerId: 'station-peer',
      federation: { handle: '@bob@station.example' },
    }]);
    socialMocks.readFederationContexts.mockResolvedValue([{
      federationId: 'federation-1',
      name: 'Acceptance Federation',
      status: 'active',
    }]);

    await expect(mobileAcceptanceActions['social.people.search']({
      query: '@bob@station.example',
      federationId: 'federation-1',
    })).resolves.toEqual([{
      ptid: 'ptid:bob',
      federationId: 'federation-1',
      homeStationPeerId: 'station-peer',
    }]);
    expect(socialMocks.searchSocialPeople)
      .toHaveBeenCalledWith('@bob@station.example');
  });

  it('rejects an unknown Federation context after authoritative lookup', async () => {
    socialMocks.searchSocialPeople.mockResolvedValue([]);
    socialMocks.readFederationContexts.mockResolvedValue([]);

    await expect(mobileAcceptanceActions['social.people.search']({
      query: '@bob@station.example',
      federationId: 'untrusted-federation',
    })).rejects.toThrow('acceptance.mobile.federationContextUnavailable');
  });

  it('routes Moments mutations through the active owner runtime', async () => {
    const post = {
      id: 'post-1',
      authorPtid: 'ptid:alice',
      content: {
        case: 'textPost',
        value: { text: 'hello' },
      },
      isDeleted: false,
      reactions: [],
    };
    const reaction = {
      kind: 1,
      count: 1n,
      reactedByViewer: true,
    };
    const gateway = {
      createMoment: vi.fn(async () => ({
        ok: true,
        data: { post },
      })),
      reactToPost: vi.fn(async () => ({
        ok: true,
        data: { reactions: [reaction] },
      })),
      unreactToPost: vi.fn(),
      createComment: vi.fn(async () => ({
        ok: true,
        data: {
          comment: {
            id: 'comment-1',
            postId: 'post-1',
            authorPtid: 'ptid:alice',
            content: 'comment',
            replyToCommentId: '',
            isDeleted: false,
          },
        },
      })),
      fetchComments: vi.fn(async () => ({
        ok: true,
        data: {
          comments: [],
          nextCursor: '',
          hasMore: false,
        },
      })),
    };
    const feed = {
      refresh: vi.fn(async () => true),
      state: vi.fn(() => ({
        pageOutcome: 1,
        hasMore: false,
        cursor: '',
        posts: [post],
      })),
      updateReaction: vi.fn(),
    };
    projectionMocks.readCurrentActiveMomentsRuntime.mockReturnValue({
      gateway,
      feed,
    });

    await expect(mobileAcceptanceActions['moments.feed.read']())
      .resolves.toMatchObject({
        posts: [{ postId: 'post-1', text: 'hello' }],
      });
    await expect(mobileAcceptanceActions['moments.publish']({
      text: 'hello',
      audienceKind: 1,
    })).resolves.toMatchObject({
      postId: 'post-1',
      authorPtid: 'ptid:alice',
    });
    await expect(mobileAcceptanceActions['moments.react']({
      postId: 'post-1',
      reactionKind: 1,
      active: true,
    })).resolves.toEqual([{
      kind: 1,
      count: '1',
      reactedByViewer: true,
    }]);
    await expect(mobileAcceptanceActions['moments.comment']({
      postId: 'post-1',
      content: 'comment',
    })).resolves.toMatchObject({
      commentId: 'comment-1',
      postId: 'post-1',
    });

    expect(gateway.createMoment).toHaveBeenCalledOnce();
    expect(gateway.reactToPost).toHaveBeenCalledWith('post-1', 1);
    expect(feed.updateReaction).toHaveBeenCalledWith(
      'post-1',
      [reaction],
    );
  });

  it('routes Settings writes through independent owner runtimes', async () => {
    socialMocks.readCurrentSocialProfile.mockResolvedValue({
      actorPtid: 'ptid:alice',
      profile: {
        profileRevision: 2n,
        displayName: 'Alice',
        note: '',
        region: '',
        timezone: '',
        defaultVisibility: 'followers',
        manuallyApprovesFollowers: false,
        messagePermission: 'friends',
        autoExpireDays: 30,
      },
    });
    socialMocks.updateCurrentSocialProfile.mockResolvedValue({
      actorPtid: 'ptid:alice',
      result: {
        outcome: 1,
        profile: {
          profileRevision: 3n,
          displayName: 'Alice Updated',
          note: '',
          region: '',
          timezone: '',
          defaultVisibility: 'private',
          manuallyApprovesFollowers: true,
          messagePermission: 'none',
          autoExpireDays: 90,
        },
      },
    });
    const notificationSnapshot = {
      notificationPreferencesRevision: 4n,
      preferences: [{
        category: 1,
        enabled: true,
        pushEnabled: false,
        soundEnabled: true,
      }],
    };
    const profileRuntime = {
      refreshNotificationPreferences: vi.fn(async () => ({
        ok: true,
        data: notificationSnapshot,
      })),
      updateNotificationPreferences: vi.fn(async () => ({
        ok: true,
        data: {
          outcome: 1,
          snapshot: notificationSnapshot,
        },
      })),
    };
    projectionMocks.readCurrentActiveProfileRuntime.mockReturnValue(
      profileRuntime,
    );
    const device = {
      theme: 'dark',
      fontSize: 'large',
      compactMode: true,
      mediaAutoDownload: false,
    };
    deviceMocks.loadDevicePreferences.mockResolvedValue(undefined);
    deviceMocks.persistDevicePreferences.mockResolvedValue(undefined);
    deviceMocks.readDeviceSettingsRuntimeSnapshot.mockReturnValue({
      status: 'ready',
      preferences: device,
    });

    await expect(mobileAcceptanceActions['settings.profile.read']())
      .resolves.toMatchObject({
        actorPtid: 'ptid:alice',
        profileRevision: '2',
      });
    await expect(mobileAcceptanceActions['settings.profile.update']({
      displayName: 'Alice Updated',
      defaultVisibility: 'private',
      manuallyApprovesFollowers: true,
      messagePermission: 'none',
      autoExpireDays: 90,
    })).resolves.toMatchObject({
      outcome: 1,
      profile: {
        actorPtid: 'ptid:alice',
        profileRevision: '3',
      },
    });
    await expect(mobileAcceptanceActions['settings.notifications.read']())
      .resolves.toEqual({
        revision: '4',
        preferences: [{
          category: 1,
          enabled: true,
          pushEnabled: false,
          soundEnabled: true,
        }],
      });
    await expect(mobileAcceptanceActions['settings.notifications.update']({
      category: 1,
      enabled: true,
      pushEnabled: false,
      soundEnabled: true,
    })).resolves.toMatchObject({
      outcome: 1,
      snapshot: { revision: '4' },
    });
    await expect(mobileAcceptanceActions['settings.device.update'](device))
      .resolves.toEqual(device);

    expect(socialMocks.updateCurrentSocialProfile).toHaveBeenCalledOnce();
    expect(profileRuntime.updateNotificationPreferences).toHaveBeenCalledOnce();
    expect(deviceMocks.persistDevicePreferences).toHaveBeenCalledWith(device);
  });

  it('fails closed when no active domain runtime exists', async () => {
    projectionMocks.readCurrentActiveMomentsRuntime.mockReturnValue(null);
    projectionMocks.readCurrentActiveProfileRuntime.mockReturnValue(null);

    await expect(mobileAcceptanceActions['moments.feed.read']())
      .rejects.toThrow('acceptance.mobile.activeMomentsRuntimeRequired');
    await expect(mobileAcceptanceActions['settings.notifications.read']())
      .rejects.toThrow('acceptance.mobile.activeProfileRuntimeRequired');
  });
});
