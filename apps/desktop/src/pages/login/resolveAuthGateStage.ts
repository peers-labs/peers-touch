// Top-level authentication gate stage machine.
//
// The login card coordinates three concerns that must happen in order:
//   1. Station configuration (a reachable Station is required before any
//      identity call can succeed).
//   2. Existing-account login (account picker / welcome-back / PIN).
//   3. Credential login (email/password + OAuth2 third-party providers).
//
// Stages 2 and 3 are already modeled by the inner `LoginState` machine. This
// module owns the outer gate that decides whether the card should show the
// Station setup surface or the credential/account surface, so the first-run
// flow never asks a user to sign in before a Station exists.

export type AuthGateStage = 'station_setup' | 'auth';

/**
 * A deliberate user navigation choice. `null` means "follow the automatic
 * rule"; a value pins the gate to that stage until the user leaves it.
 */
export type AuthGateOverride = AuthGateStage | null;

export interface AuthGateInput {
  /** True once the first station_list round-trip has settled. */
  hydrated: boolean;
  /** True when at least one Station is registered locally. */
  hasStation: boolean;
  /** Optional manual pin (e.g. the gear re-opens Station setup). */
  override: AuthGateOverride;
}

/**
 * Resolve which top-level surface the auth card must present.
 *
 * - Before hydration we stay on `station_setup` (the surface renders its own
 *   loading state), avoiding a flash of the login form on first run.
 * - After hydration, an unconfigured install stays on `station_setup`; a
 *   configured one advances to `auth`.
 * - An explicit user override always wins, so the gear can re-open Station
 *   setup even after a Station has been configured.
 */
export function resolveAuthGateStage(input: AuthGateInput): AuthGateStage {
  if (input.override) return input.override;
  if (!input.hydrated) return 'station_setup';
  return input.hasStation ? 'auth' : 'station_setup';
}

/**
 * Whether the current stage is shown because of an automatic first-run rule
 * rather than a user action. Drives hint copy such as "set up a Station to
 * continue" vs the neutral gear popover title.
 */
export function isAutoStationSetup(input: AuthGateInput): boolean {
  return (
    resolveAuthGateStage(input) === 'station_setup'
    && input.override === null
  );
}
