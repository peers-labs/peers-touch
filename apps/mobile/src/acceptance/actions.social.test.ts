// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const socialMocks = vi.hoisted(() => ({
  readCurrentSocialProfile: vi.fn(),
  searchSocialPeople: vi.fn(),
  readFederationContexts: vi.fn(),
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
const privateMomentRuntimeMocks = vi.hoisted(() => ({
  trackPublicMomentPublish: vi.fn(async (operation, isPublished) => {
    const result = await operation();
    isPublished(result);
    return result;
  }),
}));

vi.mock('../features/social/socialRuntime', () => ({
  acceptSocialFriendRequest: vi.fn(),
  applySocialFriendRequestProjectionCheckpoints: vi.fn(),
  readSocialRuntimeProjection: vi.fn(),
  readCurrentSocialProfile: socialMocks.readCurrentSocialProfile,
  readFederationContexts: socialMocks.readFederationContexts,
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

vi.mock('../runtimes/privateMomentsRuntime', async (importOriginal) => ({
  ...await importOriginal(),
  trackPublicMomentPublish:
    privateMomentRuntimeMocks.trackPublicMomentPublish,
}));

import { mobileAcceptanceActions, publicCallSnapshot } from './actions';

describe('Mobile Acceptance social actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the explicit Federation context for a people search', async () => {
    socialMocks.searchSocialPeople.mockResolvedValue([{
      id: 'ptid:bob',
      ptid: 'ptid:bob',
      homeStationPeerId: 'station-four',
      username: 'bob',
      displayName: 'Bob',
      avatar: '',
    }]);
    await expect(
      mobileAcceptanceActions['social.people.search']({
        query: 'bob',
        federationId: 'federation-1',
      }),
    ).resolves.toEqual([{
      ptid: 'ptid:bob',
      federationId: 'federation-1',
      homeStationPeerId: 'station-four',
    }]);
    expect(socialMocks.searchSocialPeople)
      .toHaveBeenCalledExactlyOnceWith('bob', 'federation-1');
  });

  it('reads Federation contexts through the active Social runtime', async () => {
    socialMocks.readFederationContexts.mockResolvedValue([{
      federationId: 'fed-1',
      name: 'Primary',
      status: 'active',
    }]);

    await expect(mobileAcceptanceActions['federation.context.read']())
      .resolves.toEqual({
        federations: [{
          federationId: 'fed-1',
          name: 'Primary',
          status: 'active',
        }],
      });
  });

  it('routes Moments reads and mutations through the facade intent port', async () => {
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
    const intents = {
      refreshPublicFeed: vi.fn(async () => true),
      publishPublic: vi.fn(async () => ({
        ok: true,
        data: { post },
      })),
      setPublicReaction: vi.fn(async () => ({
        ok: true,
        data: { reactions: [reaction] },
      })),
      createPublicComment: vi.fn(async () => ({
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
      readPublicComments: vi.fn(async () => ({
        ok: true,
        data: {
          comments: [],
          nextCursor: '',
          hasMore: false,
        },
      })),
    };
    const state = vi.fn(() => ({
      home: {
        pageOutcome: 1,
        hasMore: false,
        cursor: '',
        posts: [post],
      },
    }));
    projectionMocks.readCurrentActiveMomentsRuntime.mockReturnValue({
      intents,
      state,
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
    await expect(mobileAcceptanceActions['moments.comments.read']({
      postId: 'post-1',
    })).resolves.toEqual([]);

    expect(intents.refreshPublicFeed).toHaveBeenCalledOnce();
    expect(intents.publishPublic).toHaveBeenCalledOnce();
    expect(intents.setPublicReaction).toHaveBeenCalledWith('post-1', 1, true);
    expect(intents.createPublicComment).toHaveBeenCalledOnce();
    expect(intents.readPublicComments).toHaveBeenCalledWith('post-1', '', 50);
  });

  it('does not route a private audience through the legacy public publish action', async () => {
    const publishPublic = vi.fn();
    projectionMocks.readCurrentActiveMomentsRuntime.mockReturnValue({
      intents: { publishPublic },
      state: vi.fn(),
    });

    await expect(mobileAcceptanceActions['moments.publish']({
      text: 'private',
      audienceKind: 2,
    })).rejects.toThrow('acceptance.mobile.privateMomentRequiresNativeAction');

    expect(publishPublic).not.toHaveBeenCalled();
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

  it('projects rejected terminal call state consistently across clients', () => {
    expect(publicCallSnapshot({
      callId: '01K5TCALL00000000000000000',
      state: 'ended',
      endReason: 'rejected',
      winningDeviceId: 'bob-mobile',
    })).toEqual({
      callId: '01K5TCALL00000000000000000',
      state: 'rejected',
      winningDeviceId: 'bob-mobile',
    });
  });
});
