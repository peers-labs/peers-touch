# Desktop PIN Recovery

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-26 | **Updated**: 2026-07-26
> **Owner**: Architecture Team
> **Module**: `apps/desktop/`

---

## 1. Document Scope

This document defines the Desktop-local recovery flow for a user who has
forgotten the PIN that protects a persisted session.

It defines:

- the PIN recovery threat model;
- identity lifecycle transitions;
- account and provider binding;
- Desktop Web and Desktop Rust ownership;
- authenticated PIN replacement and persistence semantics;
- cancellation, failure, multi-account, and multi-window behavior;
- verification requirements.

It does not define:

- Station password recovery;
- server-side PIN storage or recovery;
- biometric authentication;
- remote PIN administration;
- multi-device PIN synchronization.

The canonical Desktop identity state machine remains
[`identity-lifecycle.md`](./identity-lifecycle.md). This document refines that
state machine for PIN recovery only.

---

## 2. Evidence Ledger

| Claim | Class | Evidence | Consequence |
|---|---|---|---|
| The PIN is local-only and derives the AES-256-GCM key through Argon2id. | `verified_fact` | `apps/desktop/src-tauri/src/domain/pin_lock/mod.rs` | Station cannot recover the old encrypted session. |
| The encrypted session cannot be decrypted without the PIN-derived key. | `verified_fact` | `EncryptedSession` and `decrypt_session` in `domain/pin_lock` | Recovery must obtain a fresh Station session instead of decrypting the old one. |
| Fresh login currently routes an account with `has_pin=true` to `relink_pin`. | `verified_fact` | `LoginPage.tsx::continueAfterFreshAuth` | The existing post-login flow cannot complete forgotten-PIN recovery because relinking requires the forgotten PIN. |
| Identity transitions and reconciliation are owned by `identityLifecycle.ts` and `identityRuntime.ts`. | `verified_fact` | `identity-lifecycle.md`; `desktop-identity-lifecycle-closure.md` | A page-local navigation shortcut is forbidden. |
| `set_account_pin` can replace PIN protection while encrypting the current token. | `verified_fact` | `auth_identity::set_account_pin` | The cryptographic operation already exists, but recovery needs a stricter authenticated and account-bound application contract. |
| OAuth providers can always force fresh interactive authentication. | `hypothesis` | Provider behavior has not been verified for every configured OAuth adapter. | OAuth recovery remains gated until each provider path proves interactive reauthentication. |

---

## 3. Core Principles

1. **Recover identity, not ciphertext**  
   The old encrypted token is not decrypted or recovered. The user proves their
   identity to Station and receives a fresh session.

2. **Preserve recoverable local state until replacement commits**  
   Starting or cancelling recovery must not delete `PinProtection` or
   `EncryptedSession`.

3. **Fresh authentication must be interactive**  
   Session restoration, cached OAuth bridging, and an existing in-memory
   session are not sufficient proof for PIN recovery.

4. **Bind recovery to exactly one local account**  
   Authentication must resolve to the account that entered recovery. No command
   may accept an unchecked account identifier and mutate another account.

5. **Fresh authentication produces a one-time Rust-owned grant**  
   A generic active token does not prove that authentication was performed for
   recovery. Desktop Rust must authorize a short-lived, window-bound recovery
   grant after successful interactive authentication.

6. **Identity lifecycle owns the transition**  
   Views render recovery state and submit user intent. `identityRuntime` owns
   effects, transitions, cancellation, and reconciliation.

7. **Commit PIN protection and encrypted session together**  
   The replacement is successful only when the new PIN protection and the fresh
   encrypted session are persisted as one account-state update.

---

## 4. Target Runtime Flow

```text
┌─────────────────────────────────────────────────────────────┐
│ pinGate(targetLocalAccountId)                               │
│                                                             │
│ Enter PIN                                      Forgot PIN?  │
└──────────────────────────────┬──────────────────────────────┘
                               │ confirm recovery
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ pinRecoveryAuthenticating                                   │
│                                                             │
│ Desktop Rust holds a window-bound recovery grant             │
│ target account and provider are fixed in that grant          │
│ old PinProtection + EncryptedSession remain unchanged       │
│ password: Station password login                            │
│ OAuth: forced interactive provider authorization            │
└──────────────────────────────┬──────────────────────────────┘
                               │ fresh auth succeeds
                               │ authenticated account matches target
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ pinRecoveryPendingPin                                       │
│                                                             │
│ fresh token exists in the current window only               │
│ business shell remains unavailable                          │
│ user must enter and confirm a new PIN; skip is forbidden    │
└──────────────────────────────┬──────────────────────────────┘
                               │ authenticated atomic rekey
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Desktop Rust                                                │
│                                                             │
│ require authorized, unexpired recovery grant                 │
│ use the target account and fresh token bound to that grant   │
│ create new PinProtection                                    │
│ encrypt fresh token under new PIN                           │
│ persist both values in one identities.json account update   │
│ purge any raw session file                                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ commit succeeds
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ authenticated                                               │
│                                                             │
│ clear recovery context                                      │
│ run the normal profile/account reconciliation closure       │
└─────────────────────────────────────────────────────────────┘
```

The old persisted PIN state remains valid through authentication and new-PIN
entry. It is replaced only by the successful rekey commit. A restored or
unrelated active session cannot manufacture an authorized recovery grant.

---

## 5. Ownership and Sources of Truth

| Concern | Owner | Source of truth |
|---|---|---|
| Station credential validity and fresh session issuance | Station auth | Station session state |
| Recovery target, phase, and completion | `identityLifecycle.ts` + `identityRuntime.ts` | Identity runtime state |
| Recovery authorization and fresh-token binding | Desktop Rust application state | Short-lived, window-bound recovery grant |
| PIN verification and cryptography | Desktop Rust `domain/pin_lock` | Domain implementation |
| Account PIN/session persistence | Desktop Rust `auth_identity` + `session_vault` | `identities.json` and raw-session policy |
| Recovery UI | Desktop Web login views | Runtime phase projection |
| Account projection after completion | Identity reconciliation closure | `session.currentUser` + account registry projection |

The PIN remains device-local. Station is not given the PIN and does not own PIN
recovery state.

---

## 6. Architecture Decisions

### D-01: Recovery Requires Fresh Interactive Authentication

**Status**: proposed

PIN recovery uses the account's configured provider:

- password account: submit account identifier and password to Station;
- OAuth account: start a provider authorization flow that forces user
  interaction or otherwise yields Station-recognized recent-auth proof;
- provider without a verified interactive reauthentication path: fail with
  `PIN_RECOVERY_REAUTH_UNAVAILABLE`.

The following are forbidden as recovery proof:

- `auth_restore_session`;
- PIN unlock;
- cached raw or encrypted session reuse;
- silent `ensureStationSession`;
- an unrelated account's active session.

**Consequence**: OAuth recovery may require provider-specific work. The design
does not claim zero Station or provider-adapter changes until this behavior is
verified.

### D-02: Recovery Is Non-Destructive Until Commit

**Status**: proposed

`PIN_RECOVERY_REQUESTED` records an in-memory recovery context and changes the
identity phase. It does not mutate `identities.json`.

If authentication, network access, new-PIN entry, or persistence fails, the old
PIN protection and encrypted session remain unchanged.

**Consequence**: If the user later remembers the old PIN, they can still unlock
the persisted session.

### D-03: Desktop Rust Owns a Short-Lived Recovery Grant

**Status**: proposed

PIN recovery does not expose an unauthenticated destructive command such as:

```text
account_forgot_pin(account_id)
```

Starting recovery creates a non-destructive, opaque grant in Desktop Rust
application state:

```text
PinRecoveryGrant
  recovery_id
  window_label
  target_local_account_id
  provider
  state: awaiting_auth | authorized
  fresh_token: present only when authorized
  expires_at
  consumed
```

The grant:

- is scoped to the requesting window;
- expires after a bounded interval;
- is not persisted across process restart;
- becomes `authorized` only after interactive authentication returns the target
  account;
- binds the fresh token to the target account;
- is consumed after a successful rekey;
- contains no PIN.

The reset command accepts the opaque `recovery_id`, not mutation authority from
a caller-selected account identifier. A generic active or restored session is
insufficient.

The local account identifier is a device-local registry key, not an actor
identity. Actor identity crossing a process boundary continues to use `ptid`.

### D-04: New PIN and Fresh Encrypted Session Commit Together

**Status**: proposed

The persistence helper constructs the new `PinProtection` and
`EncryptedSession` before mutating stored state. Both replace the target
account's old values in one account-state write.

The operation also:

- sets `has_session=true`;
- resets PIN failure counters through the new `PinProtection`;
- purges any raw session file;
- returns failure without entering the business shell if secure persistence is
  incomplete.

Retried success with the same PIN is allowed and rotates salt and nonce again.

### D-05: Recovery Cannot Be Skipped After Authentication

**Status**: proposed

After recovery authentication succeeds, the identity phase is
`pinRecoveryPendingPin`. The existing “Skip PIN” action is unavailable.

The user may cancel, but cancellation logs the fresh current-window session out
and returns to the original PIN gate without changing the persisted PIN state.

---

## 7. Identity Lifecycle Contract

### 7.1 Proposed Phases

```typescript
type IdentityPhase =
  | ExistingIdentityPhases
  | {
      kind: 'pinRecoveryAuthenticating';
      recoveryId: string;
      targetLocalAccountId: string;
      provider: string;
    }
  | {
      kind: 'pinRecoveryPendingPin';
      recoveryId: string;
      targetLocalAccountId: string;
      user: SessionUser;
      readiness: IdentityReadiness;
    };
```

Neither recovery phase allows the business shell to render.

### 7.2 Proposed Events

```typescript
type IdentityEvent =
  | ExistingIdentityEvents
  | {
      type: 'PIN_RECOVERY_REQUESTED';
      recoveryId: string;
      targetLocalAccountId: string;
      provider: string;
    }
  | { type: 'PIN_RECOVERY_CANCELLED' }
  | {
      type: 'PIN_RECOVERY_AUTHENTICATED';
      recoveryId: string;
      user: SessionUser;
    }
  | { type: 'PIN_RECOVERY_AUTH_FAILED' }
  | { type: 'PIN_RECOVERY_COMMITTED'; user: SessionUser }
  | { type: 'PIN_RECOVERY_COMMIT_FAILED' };
```

There is no synthetic `UNAUTHENTICATED` phase and no page-owned redirect.

### 7.3 Transition Table

| Current phase | Event | Next phase | Persisted PIN/session mutation |
|---|---|---|---|
| `pinGate` | `PIN_RECOVERY_REQUESTED` | `pinRecoveryAuthenticating` | None |
| `pinRecoveryAuthenticating` | auth failure | same phase with observable error | None |
| `pinRecoveryAuthenticating` | cancel | `pinGate` | None |
| `pinRecoveryAuthenticating` | matching fresh auth | `pinRecoveryPendingPin` | None |
| `pinRecoveryAuthenticating` | different account authenticated | same phase with account-mismatch error | None on target account |
| `pinRecoveryPendingPin` | commit failure | same phase with observable error | Old state preserved |
| `pinRecoveryPendingPin` | cancel | `pinGate` after fresh-session logout | None |
| `pinRecoveryPendingPin` | commit success | `authenticated` | Atomic replacement |

On successful commit, the normal authenticated-edge profile and account-cache
reconciliation closure runs before steady state.

---

## 8. Desktop Rust Command Contracts

```text
Command: account_begin_pin_recovery

Input:
  expected_local_account_id: String

Authentication:
  Not required. This command is non-destructive.

Validation:
  1. Account exists in the local registry.
  2. Account has PIN protection and an encrypted session.
  3. Provider metadata is available for interactive authentication.

Output:
  AppResult<StubPayload>
  { recovery_id: String, provider: String }
```

The provider authentication adapter receives `recovery_id`. After successful
interactive authentication, Desktop Rust validates the returned actor/account
against the grant target and changes the grant to `authorized`.

```text
Command: account_reset_pin

Input:
  recovery_id: String
  new_pin: String

Authorization:
  The grant must be authorized, unexpired, unconsumed, and owned by the
  requesting window.

Target and token:
  Both are read from the authorized grant. They are not selected by the caller.

Output:
  AppResult<StubPayload>
  { ok: true, local_account_id: String }
```

The command must not:

- accept caller-selected actor identity as mutation authority;
- treat a generic current-window session as fresh-auth proof;
- reset a non-active account;
- execute with only an old restored session;
- clear global session state for unrelated accounts or windows;
- mark login complete before secure persistence succeeds.

### 8.1 Typed Failure Reasons

| Reason | Meaning | UI behavior |
|---|---|---|
| `pin_recovery_grant_invalid` | Grant is missing, expired, consumed, or belongs to another window | Restart recovery |
| `pin_recovery_auth_required` | Grant has not completed fresh interactive authentication | Return to interactive authentication |
| `pin_recovery_account_mismatch` | Authenticated account differs from target | Keep target unchanged; ask for the correct account |
| `pin_recovery_reauth_unavailable` | Provider cannot prove fresh interactive auth | Explain provider limitation; preserve old state |
| `pin_recovery_invalid_pin` | New PIN violates domain rules | Stay on new-PIN entry |
| `pin_recovery_persist_failed` | Atomic account-state update failed | Stay pending; preserve old state |
| `pin_recovery_raw_purge_failed` | Raw-session security cleanup did not complete | Fail closed; do not enter the shell |

---

## 9. Failure, Cancellation, and Restart Semantics

| Scenario | Required behavior |
|---|---|
| User cancels confirmation | Stay at `pinGate`; no mutation |
| Network failure during reauthentication | Stay in recovery auth; no mutation |
| Wrong password/provider rejection | Show typed auth error; no mutation |
| Different account authenticates | Reject recovery for target; target state remains unchanged |
| User cancels after fresh auth | End fresh current-window session; return to original `pinGate` |
| App exits before replacement commit | In-memory recovery context is lost; next boot follows the original persisted PIN path |
| New PIN validation fails | Stay in `pinRecoveryPendingPin`; old state remains |
| Persistence fails | Fail closed; do not dispatch completion |
| Replacement succeeds | Clear recovery context and run authenticated reconciliation |

Recovery phase and Rust recovery grants are intentionally not persisted.
Restarting the app never leaves an account in a half-reset durable state.

---

## 10. Multi-Account and Multi-Window Semantics

- Recovery targets exactly the account selected at `pinGate`.
- Recovery grants are isolated by requesting window and target account.
- Other accounts' `PinProtection`, sessions, failure counters, and account rows
  are unchanged.
- The account identifier shown in the recovery form is fixed. A user must cancel
  recovery to choose another account.
- Password recovery may prefill and lock the target email/account identifier.
- OAuth recovery validates the returned provider identity against the target.
- A recovery commit updates persisted protection for the target account only.
- Other windows authenticated as other accounts are not logged out.
- Existing windows authenticated as the same account keep their current
  in-memory Station session; PIN recovery does not itself revoke server tokens.
- Any Station session-takeover behavior remains owned by the existing auth
  service and must stay observable independently of PIN recovery.

---

## 11. Allowed and Forbidden Relationships

### Allowed

- PIN recovery view → submit intent to `identityRuntime`.
- `identityRuntime` → begin a non-destructive Rust recovery grant.
- `identityRuntime` → invoke interactive provider authentication.
- Provider authentication adapter → authorize the matching Rust grant.
- `identityRuntime` → invoke grant-authorized `account_reset_pin`.
- Desktop Rust application layer → PIN domain + identity persistence.
- Successful reset → normal authenticated-edge reconciliation.

### Forbidden

- Login page directly mutating account identity stores to simulate recovery.
- Unauthenticated `account_forgot_pin(account_id)` destructive mutation.
- Generic active or restored session token authorizing PIN replacement.
- Silent session restoration satisfying fresh-auth requirements.
- Resetting one account using another account's authenticated token.
- Clearing all in-memory sessions or all accounts during a single-account reset.
- Entering the business shell while recovery persistence or raw-session cleanup
  is incomplete.

---

## 12. UX Contract

The PIN entry view adds a localized “Forgot PIN?” action.

Before recovery starts, the user sees a confirmation that:

- interactive sign-in is required;
- the existing encrypted session will not be recoverable after successful reset;
- other local accounts are unaffected.

Typing the email again is not required because the account identifier remains
fixed during recovery. Provider authentication supplies the required friction.

The new-PIN screen:

- identifies the recovered account;
- requires PIN and confirmation;
- does not expose “Skip PIN”;
- exposes cancel and retry behavior;
- never claims success before Rust persistence succeeds.

---

## 13. Non-Goals

- Recovering or decrypting the old encrypted session.
- Station-side PIN storage.
- Resetting Station passwords.
- OTP-only PIN recovery.
- Security questions.
- Biometric fallback.
- Administrator PIN reset.
- Remote wipe.
- Multi-device PIN synchronization.

---

## 14. Verification Gates

### 14.1 Reducer and Runtime Tests

- `pinGate → pinRecoveryAuthenticating` is explicit.
- Cancel before authentication returns to the original `pinGate`.
- Fresh auth for the wrong account cannot reach `pinRecoveryPendingPin`.
- Recovery phases never satisfy `identityPhaseAllowsReady`.
- Commit success runs the standard reconciliation closure.
- Commit failure remains observable and does not enter the shell.

### 14.2 Rust Tests

- Beginning recovery is non-destructive and returns a window-bound opaque grant.
- Missing, expired, consumed, and cross-window grants are rejected.
- A restored or generic active session cannot authorize a recovery grant.
- Only matching fresh interactive authentication authorizes the grant.
- Unauthenticated reset is rejected.
- Active-account mismatch is rejected.
- Old `PinProtection` and `EncryptedSession` remain byte-for-byte unchanged on
  validation, encryption, or persistence failure.
- Successful reset replaces both fields and sets `has_session=true`.
- The old PIN fails after commit; the new PIN decrypts the fresh token.
- Raw session cleanup is enforced.
- Resetting one account does not modify any other account row.

### 14.3 Functional Acceptance

- Password account: forgot PIN → password login → set new PIN → unlock after
  cold restart.
- Wrong password and offline Station preserve the old PIN path.
- Cancel before and after authentication preserves the old persisted state.
- Wrong-account OAuth return is rejected without mutating the target account.
- Multi-account picker and unrelated windows remain intact.
- Renderer reload during recovery returns to a deterministic auth gate and never
  exposes the shell.

Required Desktop checks:

```bash
cd apps/desktop
pnpm run test -- identityLifecycle useAppLifecycle
pnpm run check
pnpm run test
pnpm run build
```

---

## 15. Related Documents

- [`identity-lifecycle.md`](./identity-lifecycle.md)
- [`lifecycle.md`](./lifecycle.md)
- [`runtime-projections.md`](./runtime-projections.md)
- [`../../knowledge/invariants/desktop-identity-lifecycle-closure.md`](../../knowledge/invariants/desktop-identity-lifecycle-closure.md)
- [`../../knowledge/invariants/actor-identity-boundary.md`](../../knowledge/invariants/actor-identity-boundary.md)
