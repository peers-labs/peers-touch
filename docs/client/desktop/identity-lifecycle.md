# Desktop Identity Lifecycle

> Status: Canonical Desktop platform contract.
> Audience: Desktop client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

Desktop identity is a runtime state machine, not a collection of page effects.
The state machine owns the transition from account selection, login, PIN unlock,
account switch, renderer reload, and revocation into one authenticated actor
projection.

This document is the Desktop platform source of truth for:

- login/session/auth gate phases;
- current-user profile reconciliation;
- account registry cache refresh;
- avatar remote URL and local cache readiness;
- hot-reload / renderer-reload session restoration.

It refines the top-level lifecycle in [`lifecycle.md`](./lifecycle.md) and the
Page / Runtime / Boot contract in [`runtime-projections.md`](./runtime-projections.md).
The regression guard is [`docs/knowledge/invariants/desktop-identity-lifecycle-closure.md`](../../knowledge/invariants/desktop-identity-lifecycle-closure.md).

## 2. Owner Boundary

| Concern | Owner | Rule |
| --- | --- | --- |
| Session validity | `desktop-rust` auth service + `session` store | A session is valid only after `auth_restore_session`, `auth_login`, `account_unlock`, or `account_switch` returns an actor. |
| Boot restore policy | `IdentityBootResolution` in `apps/desktop/src/kernel/identityLifecycle.ts` | Boot must decide `resolveSession` vs `authGate` as an explicit policy object, not an inline boolean. |
| Authenticated edges | `IdentityAuthenticatedEdge` in `apps/desktop/src/kernel/identityLifecycle.ts` | Password/OAuth login, restore, PIN unlock, account switch, and applet launch must be represented as named edges with completion semantics. |
| Identity phase | `apps/desktop/src/kernel/identityLifecycle.ts` | The reducer is the single phase model for boot, gates, restore, authenticated, pending completion, and revoked states. |
| Identity effects | `apps/desktop/src/kernel/identityRuntime.ts` | Effects call Rust commands and must feed observable reducer events. |
| Account registry | `accountIdentity` store + Rust `identities.json` | Login pages and shell UI must observe the same refreshed account projection. |
| Current profile | Station profile via `sync_user_profile` | After any authenticated edge, current profile sync is part of identity reconciliation. |
| Avatar local cache | `UserSquareAvatar` + Rust avatar cache | Frontend stores the remote URL; local file resolution is a rendering cache, not separate identity truth. |

Pages and popovers may render identity state. They must not become the owner of
session/profile/account/avatar freshness.

## 3. Phase Model

The top-level phase is `IdentityPhase`:

```text
booting
  -> checkingLaunchContext
  -> resolvingSession
  -> accountGate | pinGate | authenticated
accountGate
  -> authenticatedPendingCompletion
  -> profileSyncing
  -> accountCacheRefreshing
  -> authenticated(ready after login completion / PIN decision)
authenticated
  -> profileSyncing
  -> accountCacheRefreshing
  -> authenticated(ready with reconciliation substates)
authenticated
  -> revoked | loggingOut
loggingOut
  -> accountGate(logout)
```

`loggingOut` projects to the non-interactive `resuming` shell. It must not
mount the account gate or start account projection reads until teardown has
completed.

The reducer stores substate on authenticated phases:

| Substate | Values | Meaning |
| --- | --- | --- |
| `profile` | `unknown`, `syncing`, `ready`, `stale`, `failed` | Station current-user profile freshness. |
| `accountCache` | `unknown`, `refreshing`, `ready`, `failed` | Local account registry freshness after the actor edge. |
| `avatar` | `unknown`, `remoteKnown` | Remote avatar URL known by identity. Local image caching belongs to `UserSquareAvatar` and must not become a second identity state. |

`ready` UI may be entered with `profile=stale` or `profile=failed` only when
the session is valid and the UI has a deterministic fallback. Such degraded
states must stay observable in the reducer. Silent `.catch(() => {})` identity
effects are not allowed.

## 4. Required Transition Closure

Every authenticated edge must run the same reconciliation closure:

```text
IdentityAuthenticatedEdge
  -> kind: fresh_login | completed_login | restored_session | pin_unlock | account_switch | applet_launch
  -> completion: pending | ready
  -> set current session user from auth response / restored session
  -> for fresh password/OAuth login, enter authenticatedPendingCompletion
     until the login page finishes set/relink/skip PIN
  -> PROFILE_SYNC_STARTED
  -> sync_user_profile
  -> update session.currentUser from synced profile
  -> ACCOUNT_CACHE_REFRESH_STARTED
  -> accountIdentity.load
  -> refresh knownAccounts from account_list_restorable
  -> PROFILE_SYNC_SUCCEEDED / PROFILE_SYNC_FAILED
  -> ACCOUNT_CACHE_REFRESH_SUCCEEDED / ACCOUNT_CACHE_REFRESH_FAILED
```

Authenticated edges are:

- password login;
- OAuth bridge login;
- completed login after PIN decision or compatibility completion;
- PIN unlock;
- account switch;
- renderer reload restore;
- applet product-window launch when it materializes an actor.

The closure must update both:

- shell identity projection: `session.currentUser`;
- auth gate projection: `knownAccounts` / `accountIdentity`.

If these projections are updated by different paths, account picker avatars and
shell avatars can diverge. That is a state-machine violation.

`knownAccounts` must be returned as a projection, not raw file order:

```text
active account first
  -> then last_login_at descending
  -> then stable name/id tie-breakers
```

This prevents stale historical rows in `identities.json` from masking the row
that was just refreshed by `sync_user_profile`.

## 5. Hot Reload Policy

Desktop intentionally distinguishes cold launch from renderer reload:

| Boot reason | Default behavior |
| --- | --- |
| `cold_launch` | Restore the persisted active session when one exists, then run the full profile/account reconciliation closure. If no valid session exists, show auth/account gate. |
| `renderer_reload` | Restore the live session and run the full profile/account reconciliation closure. |
| `applet_launch` | Accept applet launch context only when actor context is present. |

The renderer reload marker is an implementation detail. It must only decide
whether session resolution starts automatically; it must not skip profile or
account reconciliation.

Implementation rule:

```text
IdentityBootReason + IdentityPolicy
  -> IdentityBootResolution(resolveSession | authGate)
  -> resolveSession(source) | loadAuthGate(reason)
```

Runtime code must not branch on raw booleans such as
`allowRestoreOnColdLaunch`; boot behavior must be visible as a named
`IdentityBootResolution`.

## 6. Invariants

- `authenticated` without a current actor is invalid.
- `authenticatedPendingCompletion` may refresh profile/account data, but it
  must not expose the business shell until `LOGIN_COMPLETED`.
- `ready` without a valid session is invalid.
- `loggingOut` must not start auth-gate account projection reads; the runtime
  enters `accountGate(logout)` only after session teardown completes.
- Every transition into an authenticated actor must be represented as an
  `IdentityAuthenticatedEdge`.
- Boot restore decisions must go through `IdentityBootResolution`.
- `sync_user_profile` failures must be represented as `profile=failed` or `profile=stale`.
- `accountIdentity.load` failures must be represented as `accountCache=failed`.
- `knownAccounts` must refresh after successful profile sync because account
  picker identity data is sourced from the local account registry.
- `knownAccounts` must not preserve `identities.json` insertion order; the
  active/current row must be first, followed by most recent login rows.
- `session.currentUser.avatarUrl` and `knownAccounts[].avatar` must derive from
  the same remote avatar URL after reconciliation.
- User-facing identity UI must not read one-off profile data and replace the
  shell identity projection without feeding the state machine.

## 7. Implementation Map

| File | Responsibility |
| --- | --- |
| `apps/desktop/src/kernel/identityLifecycle.ts` | Pure identity phase and substate reducer. |
| `apps/desktop/src/kernel/identityRuntime.ts` | Framework-level identity runtime: boot, auth gates, authenticated-edge effects, profile/account reconciliation, and subscriptions. |
| `apps/desktop/src/hooks/useAppLifecycle.ts` | React adapter over `identityRuntime`; must not own identity transition effects. |
| `apps/desktop/src/store/session.ts` | Holds current authenticated actor projection; must not own login/OAuth edge effects. |
| `apps/desktop/src/store/accountIdentity.ts` | Holds local account registry projection; switch/unlock commands are subordinate to `identityRuntime`. |
| `apps/desktop/src/pages/LoginPage.tsx` | Pure auth-gate renderer and user action surface. |
| `apps/desktop/src/components/UserProfilePopover.tsx` | Renderer for current identity details; not profile freshness owner. |
| `apps/desktop/src/components/common/UserSquareAvatar.tsx` | Remote URL to local file avatar cache resolver. |

## 8. Verification

Required automated checks:

- `cd apps/desktop && pnpm run test -- identityLifecycle useAppLifecycle`
- `cd apps/desktop && pnpm run check`

Required functional checks:

- password login updates shell avatar and account picker avatar from the same profile;
- PIN unlock runs profile/account reconciliation before shell steady state;
- account switch refreshes session, profile, account cache, and shell avatar;
- renderer reload keeps the session and refreshes profile/account cache;
- profile sync failure is represented as `profile=failed` rather than being swallowed.
