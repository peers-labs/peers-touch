---
kind: invariant
title: Desktop identity projections must close through the state machine
status: active
owns:
  - apps/desktop/src/kernel/identityLifecycle.ts
  - apps/desktop/src/kernel/identityRuntime.ts
  - apps/desktop/src-tauri/src/application/account/mod.rs
  - apps/desktop/src/hooks/useAppLifecycle.ts
  - apps/desktop/src/store/session.ts
  - apps/desktop/src/store/accountIdentity.ts
  - apps/desktop/src/pages/LoginPage.tsx
  - apps/desktop/src/components/settings/AccountTab.tsx
  - apps/desktop/src/components/UserProfilePopover.tsx
  - apps/desktop/src/components/AppSideNav.tsx
  - docs/client/desktop/identity-lifecycle.md
referenced-by:
  - docs/client/desktop/identity-lifecycle.md
related:
  - docs/client/desktop/lifecycle.md
detected: 2026-06-18
---

# Desktop identity projections must close through the state machine

## What must hold

Any change that affects Desktop login state, current-user profile, account
registry rows, or shell/avatar identity MUST flow through
`identityLifecycle.ts` and the `identityRuntime` reconciliation closure. Pages,
popovers, and settings panels MUST NOT independently patch profile/account/avatar
state as their own freshness mechanism.

Logout MUST enter a non-ready, non-auth-gate lifecycle phase before clearing
the session mirror and must project the non-interactive `resuming` shell.
Auth-gate account projection reads may begin only after the Rust session and
local runtime teardown completes.

## Why this is non-negotiable

Desktop identity is visible in multiple places at once: account picker,
welcome-back card, sidebar avatar, profile popover, settings account page, and
runtime boot gates. If each surface fetches or writes identity data on its own,
the UI can show one account during login and another account after entering the
shell.

The repeated failure mode is projection fragmentation: `knownAccounts` reads the
local account registry, the shell reads `session.currentUser`, and the profile
popover can read Station profile directly. Without one authenticated-edge
closure, hot reload can restore a session without refreshing profile/account
cache, and profile sync failures become invisible because they are swallowed by
best-effort page code.

The state machine must therefore own both phase and freshness substates:
session, profile, account cache, and remote avatar identity. Degraded profile/account
states are acceptable only when represented in the reducer and still backed by a
valid session.

## How to verify

- `rg "syncUserProfile\\(\\).*catch\\(\\(\\) => \\{\\}\\)" apps/desktop/src` — must return zero hits for identity lifecycle paths.
- `rg "PROFILE_SYNC_STARTED|ACCOUNT_CACHE_REFRESH_STARTED" apps/desktop/src/kernel/identityLifecycle.ts apps/desktop/src/kernel/identityRuntime.ts` — must show reducer events and runtime dispatches.
- `cd apps/desktop && pnpm run test -- identityLifecycle useAppLifecycle` — must prove `LOGOUT_REQUESTED` blocks session revalidation and auth-gate reads until teardown completes.
- `cd apps/desktop && pnpm run test -- identityLifecycle useAppLifecycle` — must pass.
- `cd apps/desktop && pnpm run check` — must pass.
- Manual acceptance: password login, PIN unlock, account switch, and renderer reload must all refresh `session.currentUser`, `accountIdentity`, and `knownAccounts` through the same authenticated-edge reconciliation closure.

## Crosswalks

- See `docs/client/desktop/identity-lifecycle.md` for the platform contract.
- See `docs/client/desktop/lifecycle.md` for the top-level Desktop lifecycle.
