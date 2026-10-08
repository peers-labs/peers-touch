// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, describe, expect, it } from 'vitest';

import {
  RECOVERY_SURFACE_FIXTURE_IDS,
  isRecoverySurfaceFixtureId,
  recoveryStateForFixture,
  setRecoverySurfaceFixture,
} from './recoverySurfaceFixture';

describe('Recovery surface fixture', () => {
  afterEach(() => {
    setRecoverySurfaceFixture(null);
  });

  it('accepts exactly the whole-product recovery inventory IDs', () => {
    expect(RECOVERY_SURFACE_FIXTURE_IDS).toHaveLength(16);
    expect(isRecoverySurfaceFixtureId('recovery.command')).toBe(true);
    expect(isRecoverySurfaceFixtureId('recovery.not-real')).toBe(false);
  });

  it('maps each runtime-backed surface to a production recovery state', () => {
    const surfacesWithoutProjectionState = new Set([
      'recovery.session-valid-restore',
      'recovery.scope-exit',
    ]);
    for (const surfaceId of RECOVERY_SURFACE_FIXTURE_IDS) {
      const state = recoveryStateForFixture(surfaceId);
      if (surfacesWithoutProjectionState.has(surfaceId)) {
        expect(state, surfaceId).toBeNull();
      } else {
        expect(state?.kind, surfaceId).toBeTruthy();
      }
    }
  });

  it('publishes and clears one selected fixture surface', () => {
    expect(setRecoverySurfaceFixture('recovery.session-revoked')).toMatchObject({
      surfaceId: 'recovery.session-revoked',
    });
    expect(setRecoverySurfaceFixture(null)).toMatchObject({
      surfaceId: null,
    });
  });
});
