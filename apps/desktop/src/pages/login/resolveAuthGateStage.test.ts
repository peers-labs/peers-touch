import { describe, expect, it } from 'vitest';

import {
  isAutoStationSetup,
  resolveAuthGateStage,
  type AuthGateInput,
} from './resolveAuthGateStage';

function input(partial: Partial<AuthGateInput>): AuthGateInput {
  return {
    hydrated: false,
    hasStation: false,
    override: null,
    ...partial,
  };
}

describe('resolveAuthGateStage', () => {
  it('stays on station_setup before hydration to avoid a login-form flash', () => {
    expect(resolveAuthGateStage(input({}))).toBe('station_setup');
    expect(
      resolveAuthGateStage(input({ hydrated: false, hasStation: true })),
    ).toBe('station_setup');
  });

  it('forces first-run Station setup when no Station is registered', () => {
    expect(
      resolveAuthGateStage(input({ hydrated: true, hasStation: false })),
    ).toBe('station_setup');
  });

  it('advances to auth once a Station exists', () => {
    expect(
      resolveAuthGateStage(input({ hydrated: true, hasStation: true })),
    ).toBe('auth');
  });

  it('lets a manual override re-open Station setup after configuration', () => {
    expect(
      resolveAuthGateStage(
        input({
          hydrated: true,
          hasStation: true,
          override: 'station_setup',
        }),
      ),
    ).toBe('station_setup');
    // And a manual pin to auth is honored too.
    expect(
      resolveAuthGateStage(
        input({
          hydrated: true,
          hasStation: false,
          override: 'auth',
        }),
      ),
    ).toBe('auth');
  });
});

describe('isAutoStationSetup', () => {
  it('is true only for the automatic first-run rule without an override', () => {
    expect(
      isAutoStationSetup(input({ hydrated: true, hasStation: false })),
    ).toBe(true);
    expect(
      isAutoStationSetup(
        input({
          hydrated: true,
          hasStation: true,
          override: 'station_setup',
        }),
      ),
    ).toBe(false);
    expect(
      isAutoStationSetup(input({ hydrated: true, hasStation: true })),
    ).toBe(false);
  });
});
