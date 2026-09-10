/**
 * momentsProjectionDescriptor.ts — Moments projection runtime descriptor
 *
 * Owns the Moments/timeline feed projection lifecycle. Receives post events
 * from the shared social ingress and manages timeline state.
 *
 * Failure closure: module failure renders unavailable state, never
 * fabricated empty data.
 */

import type { SocialEventIngressController, MomentsDataEvent } from './socialEventIngress';

// ---------------------------------------------------------------------------
// Moments projection descriptor metadata
// ---------------------------------------------------------------------------

export const MOMENTS_PROJECTION_ID = 'moments-projection' as const;

// ---------------------------------------------------------------------------
// Projection state
// ---------------------------------------------------------------------------

export type MomentsAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface MomentsProjectionState {
  readonly availability: MomentsAvailability;
  readonly lastCursor: string;
  readonly postCount: number;
}

// ---------------------------------------------------------------------------
// Projection controller
// ---------------------------------------------------------------------------

export interface MomentsProjectionController {
  /** Current projection state */
  state: () => MomentsProjectionState;

  /** Ingest a moments data event from the shared ingress */
  ingestEvent: (event: MomentsDataEvent) => void;

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

export function createMomentsProjection(
  ingress: SocialEventIngressController,
): MomentsProjectionController {
  let availability: MomentsAvailability = { available: true };
  let lastCursor = '';
  let postCount = 0;
  let torn = false;

  function state(): MomentsProjectionState {
    return { availability, lastCursor, postCount };
  }

  function ingestEvent(event: MomentsDataEvent): void {
    if (torn) return;
    if (!availability.available) return;

    // Track cursor for pagination continuity
    lastCursor = event.cursor;
    postCount += 1;
  }

  function markUnavailable(reason: string): void {
    if (torn) return;
    // Failure closure: render unavailable state, never fabricated empty data
    availability = { available: false, reason };
  }

  function markAvailable(): void {
    if (torn) return;
    availability = { available: true };
  }

  function teardown(): void {
    torn = true;
  }

  return {
    state,
    ingestEvent,
    markUnavailable,
    markAvailable,
    teardown,
  };
}
