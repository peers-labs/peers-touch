import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../../features/auth/authSession';
import { ProfileUpdateOutcome } from '../../gen/proto/domain/actor/actor_pb';
import {
  NotificationCategory,
  NotificationPreferencesUpdateOutcome,
  UpdateNotificationPreferencesRequestSchema,
} from '../../gen/proto/domain/notification/notification_pb';
import {
  createNotificationPreferenceGateway,
  createProfileGateway,
} from './profileGateway';

vi.mock('../../runtimes/mutationAdmission', () => ({
  MobileMutationAdmissionError: class MobileMutationAdmissionError extends Error {},
  requireMobileMutationAdmission: vi.fn(),
}));
vi.mock('../stationTransport', () => ({
  executeStationOperation: async (
    _session: unknown,
    operation: Record<string, unknown>,
  ) => {
    const [path, method, body] = (() => {
      switch (operation.operationId) {
        case 'actor_profile_get':
          return ['/actor/profile', 'GET', undefined];
        case 'actor_profile_update':
          return ['/actor/profile', 'POST', JSON.stringify(operation.input)];
        case 'actor_search':
          return [`/api/v1/social/users/search?q=${encodeURIComponent(String(operation.query))}`, 'GET', undefined];
        case 'federation_list':
          return ['/sub-federation/federations', 'GET', undefined];
        case 'federation_resolve':
          return [`/actor/federation/resolve?handle=${encodeURIComponent(String(operation.handle))}`, 'GET', undefined];
        case 'notification_preferences_get':
          return ['/notification/preferences', 'GET', undefined];
        case 'notification_preferences_update':
          return ['/notification/preferences', 'POST', JSON.stringify(operation.input)];
        default:
          throw new Error(`unexpected operation: ${String(operation.operationId)}`);
      }
    })();
    const response = await fetch(`https://station.example${path}`, { method, body });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      bodyBytes: Array.from(new Uint8Array(await response.arrayBuffer())),
    };
  },
  responseJson: (response: { bodyBytes: number[] }) =>
    JSON.parse(new TextDecoder().decode(Uint8Array.from(response.bodyBytes))),
}));

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('profileGateway current profile', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates with the revisioned Station proto JSON shape and canonical response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED',
          profile: {
            id: '1',
            display_name: 'Alice',
            username: 'alice',
            note: 'Hello',
            avatar: 'https://cdn.example/avatar.png',
            header: 'https://cdn.example/header.png',
            region: 'CN',
            timezone: 'Asia/Shanghai',
            default_visibility: 'followers',
            manually_approves_followers: true,
            message_permission: 'friends',
            auto_expire_days: 30,
            profile_revision: '2',
          },
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createProfileGateway(session).updateCurrentProfile({
      displayName: 'Alice',
      note: 'Hello',
      avatar: 'https://cdn.example/avatar.png',
      header: 'https://cdn.example/header.png',
      region: 'CN',
      timezone: 'Asia/Shanghai',
      defaultVisibility: 'followers',
      manuallyApprovesFollowers: true,
      messagePermission: 'friends',
      autoExpireDays: 30,
    }, 1n);

    expect(result).toMatchObject({
      ok: true,
      data: {
        outcome: ProfileUpdateOutcome.APPLIED,
        profile: {
          displayName: 'Alice',
          note: 'Hello',
          region: 'CN',
          timezone: 'Asia/Shanghai',
          defaultVisibility: 'followers',
          manuallyApprovesFollowers: true,
          messagePermission: 'friends',
          autoExpireDays: 30,
          profileRevision: 2n,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://station.example/actor/profile');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        display_name: 'Alice',
        note: 'Hello',
        avatar: 'https://cdn.example/avatar.png',
        header: 'https://cdn.example/header.png',
        region: 'CN',
        timezone: 'Asia/Shanghai',
        default_visibility: 'followers',
        manually_approves_followers: true,
        message_permission: 'friends',
        auto_expire_days: 30,
        observed_revision: '1',
      }),
    });
  });

  it('does not read back after Station rejects the update', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({
        code: 'PROFILE_REJECTED',
        message: 'profile rejected',
      }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createProfileGateway(session).updateCurrentProfile({
      displayName: 'Alice',
    }, 1n);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'PROFILE_REJECTED',
        status: 400,
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a missing Profile revision before transport', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createProfileGateway(session).updateCurrentProfile({
      displayName: 'Alice',
    }, 0n)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PROFILE_MUTATION' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reconciles a lost Profile response before allowing a retry', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockResolvedValueOnce(Response.json({
        code: 0,
        data: {
          id: '1',
          username: 'alice',
          display_name: 'Alice Updated',
          profile_revision: '2',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createProfileGateway(session).updateCurrentProfile({
      displayName: 'Alice Updated',
    }, 1n)).resolves.toMatchObject({
      ok: true,
      data: {
        outcome: ProfileUpdateOutcome.APPLIED,
        profile: {
          displayName: 'Alice Updated',
          profileRevision: 2n,
        },
      },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://station.example/actor/profile',
      'https://station.example/actor/profile',
    ]);
  });

  it.each([
    { display_name: 'Bob', home_station_peer_id: 'station-b', federated_handle: 'bob@example.test' },
    { displayName: 'Bob', home_station_peer_id: 'station-b', federated_handle: 'bob@example.test' },
  ])('decodes generated ActorRef search identities for %j', async (fields) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ ...fields, username: 'bob', ref: { ptid: 'ptid:bob', acct: 'bob@example.test' } }],
      total: '1',
    }), { status: 200 })));

    await expect(createProfileGateway(session).searchActors('bob')).resolves.toEqual({
      ok: true,
      data: {
        items: [{
          id: 'ptid:bob',
          ptid: 'ptid:bob',
          username: 'bob',
          displayName: 'Bob',
          homeStationPeerId: 'station-b',
          avatar: '',
        }],
        total: 1,
      },
    });
  });

  it('reports a malformed actor identity instead of an empty search result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ username: 'bob' }],
      total: '1',
    }), { status: 200 })));

    await expect(createProfileGateway(session).searchActors('bob')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ACTOR_SEARCH_RESPONSE' },
    });
  });

  it('rejects field names outside the generated Actor JSON contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ ref: { ptid: 'ptid:bob' }, homeStationPeerId: 'station-b' }],
      total: '1',
    }), { status: 200 })));
    await expect(createProfileGateway(session).searchActors('bob')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ACTOR_SEARCH_RESPONSE' },
    });
  });

  it('reads active Federation identities from the Station projection, not actor handles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      federations: [
        { federation_id: 'fed-active', name: 'Development', status: 'active' },
        { federationId: 'fed-archived', name: 'Archived', status: 'archived' },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createProfileGateway(session).listFederations();
    expect(result.ok && result.data.map((federation) => federation.federationId)).toEqual(['fed-active']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://station.example/sub-federation/federations');
  });

  it('preserves an empty Federation membership without inventing a scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      federations: [],
    }), { status: 200 })));
    await expect(createProfileGateway(session).listFederations()).resolves.toEqual({
      ok: true,
      data: [],
    });
  });

  it('fails closed on a Federation without an identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      federations: [{ status: 'active' }],
    }), { status: 200 })));
    await expect(createProfileGateway(session).listFederations()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_FEDERATION_RESPONSE' },
    });
  });

  it('resolves a federated profile through its canonical ActorRef', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      federated_handle: '@bob@station.example',
      home_station_peer_id: 'station-b',
      profile: { username: 'bob', display_name: 'Bob', ref: { ptid: 'ptid:bob' } },
      locator_seq: '7',
    })));
    const result = await createProfileGateway(session).resolveFederationHandle('@bob@station.example');
    expect(result).toMatchObject({
      ok: true,
      data: { asSearchResult: { ptid: 'ptid:bob', homeStationPeerId: 'station-b' } },
    });
  });

  it('rejects a resolved profile missing ActorRef rather than using its profile id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      profile: { id: '123', username: 'bob' },
    })));
    await expect(createProfileGateway(session).resolveFederationHandle('@bob@station.example')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ACTOR_SEARCH_RESPONSE' },
    });
  });
});

describe('notification preference gateway', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the absent actor preference contract out of the profile gateway', () => {
    const gateway = createProfileGateway(session);

    expect(gateway).not.toHaveProperty('getAccountPreferences');
    expect(gateway).not.toHaveProperty('updateAccountPreferences');
  });

  it('decodes the complete generated Station notification snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      snapshot: notificationSnapshotJson('4'),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = createNotificationPreferenceGateway(session);

    const result = await gateway.getNotificationPreferences();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('notification snapshot failed');
    expect(result.data.notificationPreferencesRevision).toBe(4n);
    expect(result.data.preferences.find(
      (preference) => preference.category === NotificationCategory.CHAT,
    )).toMatchObject({
      actorPtid: 'ptid:alice',
      enabled: true,
      pushEnabled: true,
      soundEnabled: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('updates all changed categories through one revisioned batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      outcome: 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_APPLIED',
      snapshot: notificationSnapshotJson('5', {
        category: 'NOTIFICATION_CATEGORY_SOCIAL',
        enabled: false,
        sound_enabled: false,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = createNotificationPreferenceGateway(session);
    const request = create(UpdateNotificationPreferencesRequestSchema, {
      observedRevision: 4n,
      updates: [{
        category: NotificationCategory.SOCIAL,
        enabled: false,
        pushEnabled: true,
        soundEnabled: false,
      }],
    });

    const result = await gateway.updateNotificationPreferences(request);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('notification update failed');
    expect(result.data.outcome).toBe(NotificationPreferencesUpdateOutcome.APPLIED);
    expect(result.data.snapshot.notificationPreferencesRevision).toBe(5n);
    expect(result.data.snapshot.preferences.find(
      (preference) => preference.category === NotificationCategory.SOCIAL,
    )).toMatchObject({
      actorPtid: 'ptid:alice',
      enabled: false,
      pushEnabled: true,
      soundEnabled: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://station.example/notification/preferences',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          updates: [{
            category: NotificationCategory.SOCIAL,
            enabled: false,
            push_enabled: true,
            sound_enabled: false,
          }],
          observed_revision: '4',
        }),
      }),
    );
  });

  it('reconciles a lost Notification response against the aggregate snapshot', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockResolvedValueOnce(Response.json({
        snapshot: notificationSnapshotJson('5', {
          category: 'NOTIFICATION_CATEGORY_CHAT',
          enabled: false,
        }),
      }));
    vi.stubGlobal('fetch', fetchMock);
    const request = create(UpdateNotificationPreferencesRequestSchema, {
      observedRevision: 4n,
      updates: [{
        category: NotificationCategory.CHAT,
        enabled: false,
        pushEnabled: true,
        soundEnabled: true,
      }],
    });

    await expect(
      createNotificationPreferenceGateway(session)
        .updateNotificationPreferences(request),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        outcome: NotificationPreferencesUpdateOutcome.APPLIED,
        snapshot: {
          notificationPreferencesRevision: 5n,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a newer divergent Notification readback to conflict', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockResolvedValueOnce(Response.json({
        snapshot: notificationSnapshotJson('5'),
      }));
    vi.stubGlobal('fetch', fetchMock);
    const request = create(UpdateNotificationPreferencesRequestSchema, {
      observedRevision: 4n,
      updates: [{
        category: NotificationCategory.SOCIAL,
        enabled: false,
        pushEnabled: true,
        soundEnabled: true,
      }],
    });

    await expect(
      createNotificationPreferenceGateway(session)
        .updateNotificationPreferences(request),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        outcome: NotificationPreferencesUpdateOutcome.CONFLICT,
        snapshot: {
          notificationPreferencesRevision: 5n,
        },
      },
    });
  });

  it('rejects a notification preference owned by another actor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      snapshot: notificationSnapshotJson('1', {}, 'ptid:bob'),
    })));

    await expect(
      createNotificationPreferenceGateway(session).getNotificationPreferences(),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_NOTIFICATION_PREFERENCE_RESPONSE' },
    });
  });
});

function notificationSnapshotJson(
  revision: string,
  override: Record<string, unknown> = {},
  actorPtid = 'ptid:alice',
) {
  return {
    notification_preferences_revision: revision,
    preferences: [
      'SOCIAL',
      'CHAT',
      'SYSTEM',
      'TASK',
    ].map((category) => ({
      actor_ptid: actorPtid,
      category: `NOTIFICATION_CATEGORY_${category}`,
      enabled: true,
      push_enabled: true,
      sound_enabled: true,
      ...(override.category === `NOTIFICATION_CATEGORY_${category}`
        ? override
        : {}),
    })),
  };
}
