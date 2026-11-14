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
    hasAccounts: false,
    proceeded: false,
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
    expect(
      resolveAuthGateStage(input({ hydrated: false, hasAccounts: true })),
    ).toBe('station_setup');
  });

  it('forces first-run Station setup when there is no account and no Station', () => {
    expect(
      resolveAuthGateStage(input({ hydrated: true, hasStation: false, hasAccounts: false })),
    ).toBe('station_setup');
  });

  it('rule 1: an existing account outranks Station setup even without a Station', () => {
    expect(
      resolveAuthGateStage(
        input({ hydrated: true, hasStation: false, hasAccounts: true }),
      ),
    ).toBe('auth');
    expect(
      resolveAuthGateStage(
        input({ hydrated: true, hasStation: true, hasAccounts: true }),
      ),
    ).toBe('auth');
  });

  it('rule 2: no account but a configured Station goes straight to auth', () => {
    expect(
      resolveAuthGateStage(
        input({ hydrated: true, hasStation: true, hasAccounts: false }),
      ),
    ).toBe('auth');
  });

  it('rule 3: an explicit proceed leaves first-run setup after a Station is configured', () => {
    expect(
      resolveAuthGateStage(
        input({ hydrated: true, hasStation: false, hasAccounts: false, proceeded: false }),
      ),
    ).toBe('station_setup');
    expect(
      resolveAuthGateStage(
        input({ hydrated: true, hasStation: false, hasAccounts: false, proceeded: true }),
      ),
    ).toBe('auth');
  });

  it('lets a manual override re-open Station setup after configuration', () => {
    expect(
      resolveAuthGateStage(
        input({
          hydrated: true,
          hasStation: true,
          hasAccounts: true,
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
          hasAccounts: false,
          override: 'auth',
        }),
      ),
    ).toBe('auth');
  });
});

describe('isAutoStationSetup', () => {
  it('is true only for the automatic first-run rule without an override', () => {
    expect(
      isAutoStationSetup(input({ hydrated: true, hasStation: false, hasAccounts: false })),
    ).toBe(true);
    expect(
      isAutoStationSetup(
        input({
          hydrated: true,
          hasStation: true,
          hasAccounts: true,
          override: 'station_setup',
        }),
      ),
    ).toBe(false);
    expect(
      isAutoStationSetup(input({ hydrated: true, hasStation: true, hasAccounts: false })),
    ).toBe(false);
    expect(
      isAutoStationSetup(input({ hydrated: true, hasStation: false, hasAccounts: true })),
    ).toBe(false);
  });
});
