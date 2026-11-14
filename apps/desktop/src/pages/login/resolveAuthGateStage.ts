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
  /** True when the install already holds at least one signed-in account. */
  hasAccounts: boolean;
  /**
   * Set when the user explicitly leaves first-run Station setup via the
   * "continue to sign in" action. Session-only; a fresh launch re-derives the
   * stage from hasAccounts/hasStation instead.
   */
  proceeded: boolean;
  /** Optional manual pin (e.g. the gear re-opens Station setup). */
  override: AuthGateOverride;
}

/**
 * Resolve which top-level surface the auth card must present.
 *
 * Priority (first match wins):
 * 1. An explicit override always wins (gear re-opening Station setup).
 * 2. Before hydration stay on `station_setup` to avoid a login-form flash.
 * 3. Any known account → `auth` (the account list card outranks Station setup).
 * 4. No account but a configured Station → `auth` (straight to sign-in).
 * 5. No account and no Station → `station_setup` until the user proceeds; the
 *    proceed action is disabled until a Station exists.
 */
export function resolveAuthGateStage(input: AuthGateInput): AuthGateStage {
  if (input.override) return input.override;
  if (!input.hydrated) return 'station_setup';
  if (input.hasAccounts || input.hasStation || input.proceeded) {
    return 'auth';
  }
  return 'station_setup';
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
