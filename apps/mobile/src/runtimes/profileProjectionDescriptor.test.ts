// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';

import {
  NotificationCategory,
  NotificationPreferencePatchSchema,
  NotificationPreferenceSchema,
  NotificationPreferencesSnapshotSchema,
  NotificationPreferencesUpdateOutcome,
} from '../gen/proto/domain/notification/notification_pb';
import {
  createNotificationPreferenceProjection,
  createProfileProjection,
} from './profileProjectionDescriptor';

const profile = {
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
};

describe('profile and notification preference projections', () => {
  it('keeps Profile available when Notification preferences are unavailable', async () => {
    const profileProjection = createProfileProjection({
      getCurrentProfile: vi.fn(async () => ({ ok: true, data: profile })),
    });
    const notificationProjection = createNotificationPreferenceProjection({
      getNotificationPreferences: vi.fn(async () => ({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'missing',
          method: 'GET',
          path: '/notification/preferences',
        },
      })),
      updateNotificationPreferences: vi.fn(),
    });

    await profileProjection.reconcile();
    await notificationProjection.reconcile();

    expect(profileProjection.state()).toMatchObject({
      availability: { available: true },
      currentProfile: profile,
    });
    expect(notificationProjection.state()).toMatchObject({
      availability: { available: false },
      snapshot: null,
    });
  });

  it('keeps only generated Notification preferences and replaces them from readback', async () => {
    const initial = create(NotificationPreferenceSchema, {
      actorPtid: 'ptid:alice',
      category: NotificationCategory.CHAT,
      enabled: true,
      pushEnabled: true,
      soundEnabled: true,
    });
    const updated = create(NotificationPreferenceSchema, {
      ...initial,
      enabled: false,
    });
    const initialSnapshot = create(NotificationPreferencesSnapshotSchema, {
      preferences: [initial],
      notificationPreferencesRevision: 1n,
    });
    const updatedSnapshot = create(NotificationPreferencesSnapshotSchema, {
      preferences: [updated],
      notificationPreferencesRevision: 2n,
    });
    const getNotificationPreferences = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: initialSnapshot });
    const updateNotificationPreferences = vi.fn(async () => ({
      ok: true,
      data: {
        outcome: NotificationPreferencesUpdateOutcome.APPLIED,
        snapshot: updatedSnapshot,
      },
    }));
    const projection = createNotificationPreferenceProjection({
      getNotificationPreferences,
      updateNotificationPreferences,
    });

    await projection.reconcile();
    const outcome = await projection.updatePreferences([
      create(NotificationPreferencePatchSchema, {
        category: NotificationCategory.CHAT,
        enabled: false,
        pushEnabled: true,
        soundEnabled: true,
      }),
    ]);

    expect(outcome).toEqual({
      ok: true,
      data: {
        outcome: NotificationPreferencesUpdateOutcome.APPLIED,
        snapshot: updatedSnapshot,
      },
    });
    expect(updateNotificationPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        observedRevision: 1n,
        updates: [expect.objectContaining({
          category: NotificationCategory.CHAT,
          enabled: false,
        })],
      }),
    );
    expect(getNotificationPreferences).toHaveBeenCalledOnce();
    expect(projection.state()).toMatchObject({
      availability: { available: true },
      snapshot: updatedSnapshot,
    });
  });

  it('publishes the canonical snapshot from a typed aggregate conflict', async () => {
    const social = create(NotificationPreferenceSchema, {
      actorPtid: 'ptid:alice',
      category: NotificationCategory.SOCIAL,
      enabled: false,
      pushEnabled: true,
      soundEnabled: true,
    });
    const chat = create(NotificationPreferenceSchema, {
      actorPtid: 'ptid:alice',
      category: NotificationCategory.CHAT,
      enabled: true,
      pushEnabled: false,
      soundEnabled: true,
    });
    const canonical = create(NotificationPreferencesSnapshotSchema, {
      preferences: [social, chat],
      notificationPreferencesRevision: 3n,
    });
    const projection = createNotificationPreferenceProjection({
      getNotificationPreferences: vi.fn(async () => ({
        ok: true,
        data: canonical,
      })),
      updateNotificationPreferences: vi.fn(async () => ({
        ok: true,
        data: {
          outcome: NotificationPreferencesUpdateOutcome.CONFLICT,
          snapshot: canonical,
        },
      })),
    });
    await projection.reconcile();

    const outcome = await projection.updatePreferences([
      create(NotificationPreferencePatchSchema, {
        category: NotificationCategory.SOCIAL,
        enabled: false,
        pushEnabled: true,
        soundEnabled: true,
      }),
      create(NotificationPreferencePatchSchema, {
        category: NotificationCategory.CHAT,
        enabled: true,
        pushEnabled: false,
        soundEnabled: true,
      }),
    ]);

    expect(outcome).toEqual({
      ok: true,
      data: {
        outcome: NotificationPreferencesUpdateOutcome.CONFLICT,
        snapshot: canonical,
      },
    });
    expect(projection.state()).toMatchObject({
      availability: { available: true },
      snapshot: canonical,
    });
  });
});
