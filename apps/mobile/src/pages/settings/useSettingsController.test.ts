// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  NotificationCategory,
  NotificationPreferenceSchema,
  NotificationPreferencesSnapshotSchema,
} from '../../gen/proto/domain/notification/notification_pb';
import type { PeerProfile } from '../../features/social/socialTypes';
import {
  blockedUserViews,
  buildNotificationPreferenceUpdates,
  patchNotificationPreferences,
  profileDraftFromReadback,
  reconcileEditableProfileDraft,
  reconcileNotificationPreferenceDraft,
} from './useSettingsController';

describe('blocked-user settings projection', () => {
  it('uses readable profile identity without replacing canonical PTIDs', () => {
    expect(blockedUserViews(
      [
        {
          targetPtid: 'ptid:bob',
          targetHomeStationPeerId: 'station-b',
        },
        {
          targetPtid: 'ptid:carol',
        },
      ],
      {
        'ptid:bob': profile({
          id: 'ptid:bob',
          displayName: 'Bob',
          acct: 'bob@example.test',
          avatar: 'https://cdn.example/bob.png',
        }),
      },
    )).toEqual([
      {
        targetPtid: 'ptid:bob',
        displayName: 'Bob',
        avatar: 'https://cdn.example/bob.png',
        homeStationPeerId: 'station-b',
      },
      {
        targetPtid: 'ptid:carol',
        displayName: 'ptid:carol',
        avatar: '',
        homeStationPeerId: '',
      },
    ]);
  });
});

function preference(
  category: NotificationCategory,
  enabled: boolean,
) {
  return create(NotificationPreferenceSchema, {
    actorPtid: 'ptid:alice',
    category,
    enabled,
    pushEnabled: true,
    soundEnabled: true,
  });
}

describe('notification preference settings state', () => {
  it('preserves a dirty draft when readback repeats the committed state', () => {
    const server = [preference(NotificationCategory.CHAT, true)];
    const draft = patchNotificationPreferences(server, 'enabled', false);
    const incoming = [preference(NotificationCategory.CHAT, true)];
    const committed = snapshot(1n, server);
    const readback = snapshot(1n, incoming);

    expect(reconcileNotificationPreferenceDraft(committed, draft, readback)).toEqual({
      server: readback,
      draft,
      conflict: false,
    });
  });

  it('preserves a dirty draft and reports a genuinely divergent readback', () => {
    const server = [preference(NotificationCategory.CHAT, true)];
    const draft = patchNotificationPreferences(server, 'enabled', false);
    const incoming = [
      create(NotificationPreferenceSchema, {
        ...server[0],
        soundEnabled: false,
      }),
    ];
    const committed = snapshot(1n, server);
    const readback = snapshot(2n, incoming);

    expect(reconcileNotificationPreferenceDraft(committed, draft, readback)).toEqual({
      server: readback,
      draft,
      conflict: true,
    });
  });

  it('accepts authoritative readback that confirms the local draft', () => {
    const server = [preference(NotificationCategory.CHAT, true)];
    const draft = patchNotificationPreferences(server, 'enabled', false);
    const incoming = [preference(NotificationCategory.CHAT, false)];
    const committed = snapshot(1n, server);
    const readback = snapshot(2n, incoming);

    expect(reconcileNotificationPreferenceDraft(committed, draft, readback)).toEqual({
      server: readback,
      draft: incoming,
      conflict: false,
    });
  });

  it('builds generated updates only for changed Station-owned categories', () => {
    const server = [
      preference(NotificationCategory.SOCIAL, true),
      preference(NotificationCategory.CHAT, true),
    ];
    const draft = [
      preference(NotificationCategory.SOCIAL, false),
      preference(NotificationCategory.CHAT, true),
    ];

    expect(buildNotificationPreferenceUpdates(server, draft)).toMatchObject([
      {
        category: NotificationCategory.SOCIAL,
        enabled: false,
        pushEnabled: true,
        soundEnabled: true,
      },
    ]);
  });

  it('does not invent preference categories when Station readback is empty', () => {
    expect(patchNotificationPreferences([], 'enabled', true)).toEqual([]);
    expect(buildNotificationPreferenceUpdates([], [])).toEqual([]);
  });
});

describe('profile privacy settings state', () => {
  it('keeps every Station-owned privacy field in the editable draft', () => {
    expect(profileDraftFromReadback(profile())).toMatchObject({
      defaultVisibility: 'followers',
      manuallyApprovesFollowers: true,
      messagePermission: 'friends',
      autoExpireDays: 30,
    });
  });

  it('preserves a dirty privacy draft and reports divergent Station readback', () => {
    const server = profileDraftFromReadback(profile())!;
    const draft = { ...server, messagePermission: 'none' };
    const incoming = profile({ defaultVisibility: 'private' });

    expect(reconcileEditableProfileDraft(server, draft, incoming)).toEqual({
      server: profileDraftFromReadback(incoming),
      draft,
      conflict: true,
    });
  });

  it('accepts canonical Station readback that confirms the privacy draft', () => {
    const server = profileDraftFromReadback(profile())!;
    const draft = { ...server, autoExpireDays: 90 };
    const incoming = profile({ autoExpireDays: 90 });

    expect(reconcileEditableProfileDraft(server, draft, incoming)).toEqual({
      server: profileDraftFromReadback(incoming),
      draft: profileDraftFromReadback(incoming),
      conflict: false,
    });
  });
});

function profile(overrides: Partial<PeerProfile> = {}): PeerProfile {
  return {
    id: 'ptid:alice',
    profileRevision: 1n,
    username: 'alice',
    acct: 'alice@example.test',
    displayName: 'Alice',
    note: '',
    url: '',
    avatar: '',
    header: '',
    locked: true,
    createdAt: '',
    statusesCount: 0,
    followingCount: 0,
    followersCount: 0,
    region: 'CN',
    timezone: 'Asia/Shanghai',
    tags: [],
    links: [],
    defaultVisibility: 'followers',
    manuallyApprovesFollowers: true,
    messagePermission: 'friends',
    autoExpireDays: 30,
    networkId: '',
    ...overrides,
  };
}

function snapshot(
  revision: bigint,
  preferences: readonly ReturnType<typeof preference>[],
) {
  return create(NotificationPreferencesSnapshotSchema, {
    notificationPreferencesRevision: revision,
    preferences: [...preferences],
  });
}
