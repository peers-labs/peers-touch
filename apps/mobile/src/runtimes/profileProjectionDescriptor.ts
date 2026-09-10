/**
 * profileProjectionDescriptor.ts — Profile projection runtime descriptor
 *
 * Owns profile and account-preference projection state. Receives profile
 * events from the shared social ingress.
 *
 * MS-P05: The account preference contract surface lives in the profile
 * gateway; this projection caches and projects preference state.
 *
 * Failure closure: module failure renders unavailable state, never
 * fabricated empty data.
 */

import type { SocialEventIngressController, ProfileDataEvent } from './socialEventIngress';
import type { AccountPreference } from '../services/gateways/profileGateway';

// ---------------------------------------------------------------------------
// Profile projection descriptor metadata
// ---------------------------------------------------------------------------

export const PROFILE_PROJECTION_ID = 'profile-projection' as const;

// ---------------------------------------------------------------------------
// Projection state
// ---------------------------------------------------------------------------

export type ProfileAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface ProfileProjectionState {
  readonly availability: ProfileAvailability;
  readonly cachedPreference: AccountPreference | null;
  readonly lastProfileCursor: string;
}

// ---------------------------------------------------------------------------
// Projection controller
// ---------------------------------------------------------------------------

export interface ProfileProjectionController {
  /** Current projection state */
  state: () => ProfileProjectionState;

  /** Ingest a profile data event from the shared ingress */
  ingestEvent: (event: ProfileDataEvent) => void;

  /** Update cached account preferences (from gateway readback) */
  applyPreference: (preference: AccountPreference) => void;

  /** Mark the projection as unavailable (module failure) */
  markUnavailable: (reason: string) => void;

  /** Restore availability after successful reconciliation */
  markAvailable: () => void;

  /** Teardown */
  teardown: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProfileProjection(
  ingress: SocialEventIngressController,
): ProfileProjectionController {
  let availability: ProfileAvailability = { available: true };
  let cachedPreference: AccountPreference | null = null;
  let lastProfileCursor = '';
  let torn = false;

  function state(): ProfileProjectionState {
    return { availability, cachedPreference, lastProfileCursor };
  }

  function ingestEvent(event: ProfileDataEvent): void {
    if (torn) return;
    if (!availability.available) return;

    lastProfileCursor = event.cursor;

    if (event.kind === 'preference-changed') {
      // Preference events carry the full preference in payload
      const preference = event.payload as unknown;
      if (isAccountPreference(preference)) {
        cachedPreference = preference;
      }
    }
  }

  function applyPreference(preference: AccountPreference): void {
    if (torn) return;
    cachedPreference = preference;
  }

  function markUnavailable(reason: string): void {
    if (torn) return;
    availability = { available: false, reason };
  }

  function markAvailable(): void {
    if (torn) return;
    availability = { available: true };
  }

  function teardown(): void {
    torn = true;
    cachedPreference = null;
  }

  return {
    state,
    ingestEvent,
    applyPreference,
    markUnavailable,
    markAvailable,
    teardown,
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isAccountPreference(value: unknown): value is AccountPreference {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.actorPtid === 'string'
    && typeof record.notificationEnabled === 'boolean';
}
