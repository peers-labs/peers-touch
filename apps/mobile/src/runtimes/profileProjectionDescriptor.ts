/**
 * profileProjectionDescriptor.ts — Profile and Notification preference projections
 *
 * Profile and Notification preferences share the Social ingress lifecycle but
 * keep independent availability and readback state. The absent account-wide
 * preference contract must never make the authoritative Profile unavailable.
 */

import { create } from '@bufbuild/protobuf';
import {
  UpdateNotificationPreferencesRequestSchema,
  type NotificationPreferencePatch,
  type NotificationPreferencesSnapshot,
} from '../gen/proto/domain/notification/notification_pb';
import type { PeerProfile } from '../features/social/socialTypes';
import type {
  NotificationPreferenceGateway,
  NotificationPreferencesUpdateResult,
  ProfileGateway,
} from '../services/gateways/profileGateway';
import type { CommandOutcome } from '../services/gateways/gatewayTypes';
import type { ProfileDataEvent } from './socialEventIngress';

export const PROFILE_PROJECTION_ID = 'profile-projection' as const;

export type ProfileAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface ProfileProjectionState {
  readonly availability: ProfileAvailability;
  readonly currentProfile: PeerProfile | null;
  readonly lastProfileCursor: string;
}

export interface NotificationPreferenceProjectionState {
  readonly availability: ProfileAvailability;
  readonly snapshot: NotificationPreferencesSnapshot | null;
}

export interface ProfileProjectionController {
  state: () => ProfileProjectionState;
  subscribe: (listener: () => void) => () => void;
  reconcile: () => Promise<CommandOutcome<PeerProfile>>;
  ingestEvent: (event: ProfileDataEvent) => void;
  markUnavailable: (reason: string) => void;
  markAvailable: () => void;
  teardown: () => void;
}

export interface NotificationPreferenceProjectionController {
  state: () => NotificationPreferenceProjectionState;
  subscribe: (listener: () => void) => () => void;
  reconcile: () => Promise<CommandOutcome<NotificationPreferencesSnapshot>>;
  updatePreferences: (
    updates: readonly NotificationPreferencePatch[],
  ) => Promise<CommandOutcome<NotificationPreferencesUpdateResult>>;
  markUnavailable: (reason: string) => void;
  teardown: () => void;
}

export function createProfileProjection(
  gateway: Pick<ProfileGateway, 'getCurrentProfile'>,
): ProfileProjectionController {
  let snapshot: ProfileProjectionState = {
    availability: {
      available: false,
      reason: 'mobile.settings.profileUnavailable',
    },
    currentProfile: null,
    lastProfileCursor: '',
  };
  let torn = false;
  const listeners = new Set<() => void>();

  function emit(): void {
    listeners.forEach((listener) => listener());
  }

  function replace(next: ProfileProjectionState): void {
    snapshot = next;
    emit();
  }

  function state(): ProfileProjectionState {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    if (torn) return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function reconcile(): Promise<CommandOutcome<PeerProfile>> {
    if (torn) return tornDownOutcome('/actor/profile');
    const result = await gateway.getCurrentProfile();
    if (torn) return tornDownOutcome('/actor/profile');
    if (!result.ok) {
      publishUnavailable(result.error.message);
      return result;
    }
    replace({
      ...snapshot,
      availability: { available: true },
      currentProfile: result.data,
    });
    return result;
  }

  function ingestEvent(event: ProfileDataEvent): void {
    if (torn) return;
    replace({
      ...snapshot,
      lastProfileCursor: event.cursor,
    });
  }

  function markUnavailable(reason: string): void {
    if (torn) return;
    publishUnavailable(reason);
  }

  function publishUnavailable(reason: string): void {
    replace({
      ...snapshot,
      availability: { available: false, reason },
    });
  }

  function markAvailable(): void {
    if (torn) return;
    replace({
      ...snapshot,
      availability: { available: true },
    });
  }

  function teardown(): void {
    torn = true;
    snapshot = {
      availability: {
        available: false,
        reason: 'mobile.settings.profileUnavailable',
      },
      currentProfile: null,
      lastProfileCursor: '',
    };
    listeners.clear();
  }

  return {
    state,
    subscribe,
    reconcile,
    ingestEvent,
    markUnavailable,
    markAvailable,
    teardown,
  };
}

export function createNotificationPreferenceProjection(
  gateway: NotificationPreferenceGateway,
): NotificationPreferenceProjectionController {
  let snapshot: NotificationPreferenceProjectionState = {
    availability: {
      available: false,
      reason: 'mobile.launch.unavailable',
    },
    snapshot: null,
  };
  let torn = false;
  const listeners = new Set<() => void>();

  function emit(): void {
    listeners.forEach((listener) => listener());
  }

  function replace(next: NotificationPreferenceProjectionState): void {
    snapshot = next;
    emit();
  }

  function state(): NotificationPreferenceProjectionState {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    if (torn) return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function reconcile(): Promise<CommandOutcome<NotificationPreferencesSnapshot>> {
    if (torn) return tornDownOutcome('/notification/preferences');
    const result = await gateway.getNotificationPreferences();
    if (torn) return tornDownOutcome('/notification/preferences');
    if (!result.ok) {
      publishUnavailable(result.error.message);
      return result;
    }
    replace({
      availability: { available: true },
      snapshot: result.data,
    });
    return result;
  }

  async function updatePreferences(
    updates: readonly NotificationPreferencePatch[],
  ): Promise<CommandOutcome<NotificationPreferencesUpdateResult>> {
    if (torn) return tornDownOutcome('/notification/preferences');
    if (!snapshot.snapshot || updates.length === 0) {
      return {
        ok: false,
        error: {
          code: updates.length === 0
            ? 'NOTIFICATION_PREFERENCE_BATCH_EMPTY'
            : 'NOTIFICATION_PREFERENCE_SNAPSHOT_UNAVAILABLE',
          message: 'mobile.launch.unavailable',
          method: 'POST',
          path: '/notification/preferences',
        },
      };
    }
    const result = await gateway.updateNotificationPreferences(
      create(UpdateNotificationPreferencesRequestSchema, {
        updates: [...updates],
        observedRevision: snapshot.snapshot.notificationPreferencesRevision,
      }),
    );
    if (!result.ok) return result;
    replace({
      availability: { available: true },
      snapshot: result.data.snapshot,
    });
    return result;
  }

  function markUnavailable(reason: string): void {
    if (torn) return;
    publishUnavailable(reason);
  }

  function publishUnavailable(reason: string): void {
    replace({
      ...snapshot,
      availability: { available: false, reason },
    });
  }

  function teardown(): void {
    torn = true;
    snapshot = {
      availability: {
        available: false,
        reason: 'mobile.launch.unavailable',
      },
      snapshot: null,
    };
    listeners.clear();
  }

  return {
    state,
    subscribe,
    reconcile,
    updatePreferences,
    markUnavailable,
    teardown,
  };
}

function tornDownOutcome<T>(path: string): CommandOutcome<T> {
  return {
    ok: false,
    error: {
      code: 'RUNTIME_TORN_DOWN',
      message: 'mobile.social.runtimeUnavailable',
      method: 'GET',
      path,
    },
  };
}
