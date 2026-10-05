# Desktop Client Lifecycle

> Desktop platform lifecycle source. This document gives the top-level Desktop lifecycle that corresponds to Mobile's lifecycle. Detailed login/profile/account/avatar identity state is owned by [`identity-lifecycle.md`](./identity-lifecycle.md), and detailed `desktop-web` Page / Runtime / Boot contracts remain in [`runtime-projections.md`](./runtime-projections.md).

---

## 1. Purpose

Desktop is not a single React page. It is a multi-runtime client made of:

- `desktop-app`: Tauri native window host.
- `desktop-web`: React renderer and projection reader.
- `desktop-rust`: local application runtime, command gateway, and local capability owner.
- `station`: remote business source of truth.

This document defines the user-visible and runtime lifecycle across those units. It does not redefine:

- Cross-process topology, owned by [`../../architecture/platform/client/desktop/runtime.md`](../../architecture/platform/client/desktop/runtime.md).
- Desktop identity state machine, owned by [`identity-lifecycle.md`](./identity-lifecycle.md).
- `desktop-web` kernel contracts, owned by [`runtime-projections.md`](./runtime-projections.md).
- Access gate architecture, owned by [`../../architecture/platform/station/access/station-access-gate-architecture.md`](../../architecture/platform/station/access/station-access-gate-architecture.md).

---

## 2. Lifecycle Phases

| Phase | Entry Trigger | Owner | Exit Condition |
| --- | --- | --- | --- |
| `app-boot` | Process starts | `desktop-app` + `desktop-rust` | Local gateway, storage, and WebView are ready |
| `shell-boot` | `desktop-web` starts | `desktop-web` kernel | Shell has mounted and boot telemetry starts |
| `identity-restore` | Shell boot completes | `desktop-rust` + session service | Existing account/session context is restored or rejected |
| `station-handshake` | Station context is known | `desktop-rust` + Station gateway | Station capability baseline is checked |
| `access-gate-chain` | Station handshake passes | Station access gate runtime | Station returns `access_granted` |
| `runtime-critical` | Access is granted | Runtime registry | Critical app/session runtimes bootstrap |
| `first-paint` | Critical runtime bootstrap completes | Page host | Landing page is visible |
| `runtime-idle` | First paint completes | Runtime registry | Non-critical runtimes install during idle time |
| `steady` | App is interactive | Owning runtimes | Events and reconciliation keep projections fresh |
| `session-change` | Login/logout/account switch | Session runtime owner | Old session runtimes teardown; new session bootstraps |
| `shutdown` | Window/process exits | `desktop-app` + runtimes | Timers, streams, and local resources are closed |

---

## 3. Standard Flow

```text
desktop-app boot
  -> desktop-rust gateway/storage ready
  -> desktop-web shell boot
  -> restore identity
  -> station-handshake
  -> access-gate-chain
     -> session restore / login gate
     -> invite / allowlist gate
     -> device / policy gates
  -> bootstrap critical runtimes
  -> first paint
  -> install idle runtimes
  -> steady event + reconcile loop
```

The Desktop user must not enter business surfaces that require Station access before the access gate chain has resolved. Pages may render unauthenticated shell or login/account selection UI, but they must not silently operate with a missing access grant.

---

## 4. Runtime Rules

- Station owns cross-device business truth.
- `desktop-rust` owns local command execution, local storage, local gateway behavior, and native capability coordination.
- `desktop-web` owns rendering and local projections.
- Long-lived projection freshness belongs to runtimes, not page mount effects.
- Session-scoped runtimes bootstrap on authenticated actor edges and teardown on logout/account switch.
- App-scoped runtimes may install at boot but must not assume an actor unless their contract explicitly allows it.
- Login, PIN unlock, OAuth, invite-only checks, and fixed-user checks are independent access gates controlled by Station policy.

The detailed runtime API and Boot Pipeline phases are defined in [`runtime-projections.md §6`](./runtime-projections.md#6-kernel-contracts).

---

## 5. Edge Handling

| Edge | Required Behavior |
| --- | --- |
| Cold start with valid session | Restore actor context, run access gate chain, enter shell only when granted |
| Cold start with invalid session | Clear stale session, show the current access gate |
| Logout | Teardown session runtimes, clear secrets, restart access gate chain |
| Account switch | Teardown old actor runtimes before running access gates for the new actor |
| Invite/allowlist blocked | Stay in access gate chain; do not enter ready |
| Station unreachable | Keep local shell safe; surface retry state; do not pretend projections are fresh |
| Event stream dropped | Runtime reconnects and reconciles from Station |
| Window hidden or system sleep | Runtime treats resume as stale and reconciles |

---

## 6. Symmetry With Mobile

Desktop and Mobile share the same client lifecycle intent:

```text
boot -> station/identity gate -> access gate chain -> runtime bootstrap -> shell -> steady reconcile
```

The difference is platform responsibility:

| Concern | Desktop | Mobile |
| --- | --- | --- |
| Local gateway | `desktop-rust` is required | Rust capability kernel + Tauri commands |
| Station selection | Usually configured by desktop profile / account context | First-class onboarding gate |
| Access gate chain | Account picker/login/PIN/OAuth/invite gates before business runtime | Login/invite/device gates before entering Station shell |
| Runtime freshness | SSE/stream + reconciliation | Foreground stream + push/resume delta sync |
| System lifecycle | Window/process/sleep | Foreground/background/resume/termination |

---

## 7. Verification

Before changing Desktop lifecycle behavior, verify:

- `cd apps/desktop && pnpm run check`
- `cd apps/desktop && pnpm run test`
- `cd apps/desktop && pnpm run build`
- `cd apps/desktop && source ~/.cargo/env && CI=false pnpm run tauri:build`

Functional verification must cover:

- cold start with no session;
- cold start with restored session;
- logout and account switch;
- invite/allowlist denial before ready;
- Station/network failure recovery;
- event stream reconnect plus reconciliation.
