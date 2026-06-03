# Mobile Client Lifecycle

> Mobile platform lifecycle source. This document defines the Mobile lifecycle that must stay top-level symmetric with Desktop while respecting mobile-specific Station selection, foreground/background behavior, and native capability boundaries.

---

## 1. Purpose

Mobile is a Tauri v2 Mobile client composed of:

- `mobile-app`: iOS/Android native Tauri shell.
- `mobile-web`: React renderer and mobile-first UI.
- `mobile-rust`: Rust capability kernel and Tauri command owner.
- `native-plugins`: system capabilities such as secure storage, push, deep link, camera, and background tasks.
- `station`: remote business source of truth.

This document defines the lifecycle across those units. It does not redefine:

- Mobile platform baseline, owned by [`base.md`](./base.md).
- Native plugin boundaries, owned by [`native-dual-platform.md`](./native-dual-platform.md).
- Sync mechanics, owned by [`sync-protocol.md`](./sync-protocol.md).
- Access gate architecture, owned by [`../../architecture/access-gates/station-access-gate-architecture.md`](../../architecture/access-gates/station-access-gate-architecture.md).

---

## 2. Lifecycle Phases

| Phase | Entry Trigger | Owner | Exit Condition |
| --- | --- | --- | --- |
| `app-boot` | Native app starts | `mobile-app` + `mobile-rust` | WebView, storage, language, and capability guards are ready |
| `station-selection` | No active Station or user changes Station | Station onboarding feature | A reachable Station is selected |
| `station-handshake` | Active Station selected | Station runtime | Station reachability and capability baseline are checked |
| `access-gate-chain` | Station handshake passes | Station access gate runtime | Station returns `access_granted` |
| `runtime-critical` | Access is granted | Runtime registry | Critical session projections bootstrap |
| `shell` | Critical runtime bootstrap completes | Mobile shell | Chat/contacts/mine shell becomes visible |
| `steady-foreground` | App is foregrounded | Owning runtimes | Event stream and reconciliation keep projections fresh |
| `background` | App enters background | Native lifecycle + runtimes | Streams pause or downgrade; push/background tasks take over |
| `resume` | App returns foreground | Session + sync runtimes | Session and Station are revalidated; delta sync completes |
| `station-change` | User changes Station | Station/session runtime | Old session and projections are cleared; auth gate restarts |
| `logout` | User logs out | Session runtime | Secure session is cleared; auth gate restarts |

---

## 3. Standard Flow

```text
mobile app boot
  -> load language + WebView guards + native capability ports
  -> load Station registry
  -> station-selection if no active Station
  -> station-handshake
  -> access-gate-chain
     -> session restore / login gate
     -> invite / allowlist gate
     -> device / policy gates
  -> bootstrap critical runtimes
  -> enter shell
  -> foreground event + reconcile loop
```

The user must not enter the Station shell without passing the Station-driven access gate chain. Selecting a Station is not the same as being admitted into it.

---

## 4. Gate Contracts

### 4.1 Station Selection

- The Station list is a target selector, not a navigation list.
- Tapping an existing Station selects the target to enter; it does not refill the input and does not immediately enter.
- Adding a Station is secondary once at least one Station exists.
- Station reachability must be checked automatically, not left as unexplained `unverified` UI.

### 4.2 Station Handshake

- The minimum gate verifies `host:port` reachability through `mobile-rust`, not WebView `fetch`.
- A stronger gate should verify Station identity, protocol version, auth endpoint availability, and compatible capabilities.
- HTTP may be allowed for local development or local network use, but must remain visually marked as not recommended.

### 4.3 Access Gate Chain

- Login is one gate in the chain, not the whole gate model.
- Station owns gate order, pass/fail semantics, and final access decision.
- Invite-only and fixed-user gates are managed in Station Dashboard, not Mobile.
- Auth session secrets must be stored through native secure storage, not plain `localStorage`.
- A session is scoped to the active Station. Switching Station invalidates the current session unless an explicit multi-Station session model is introduced.
- The main shell must not hide login in Settings as the only entry point.

---

## 5. Runtime Rules

- Station owns cross-device business truth.
- `mobile-rust` owns native-safe capability calls, secure storage ports, network reachability checks, and plugin bridges.
- `mobile-web` owns rendering and local projections.
- Pages render projections and user actions; long-lived freshness belongs to runtimes.
- Foreground uses event streams when available.
- Background uses push, background tasks, or deferred sync according to platform constraints.
- Resume must treat projections as stale until delta sync or reconciliation has completed.

---

## 6. Edge Handling

| Edge | Required Behavior |
| --- | --- |
| Cold start with no Station | Show Station selection |
| Cold start with Station but no session | Validate Station, then render the current access gate |
| Cold start with Station and session | Restore session, run the remaining gate chain, then enter shell only when access is granted |
| Station unreachable | Stay before auth/shell; show retry and change Station actions |
| Login failure | Stay in the login gate; keep Station selected |
| Invite/allowlist blocked | Stay in access gate chain; show Station-provided denial/retry actions |
| Station change | Clear active access attempt, session, and session projections; return to Station selection |
| Logout | Clear secure session; keep Station registry; restart access gate chain |
| App background | Pause expensive streams; keep minimal native hooks |
| App resume | Revalidate Station/session and run delta sync |
| Push received | Store or route event through native plugin into runtime; do not mutate UI directly from plugin code |

---

## 7. Symmetry With Desktop

Mobile and Desktop share the same lifecycle intent:

```text
boot -> station/identity gate -> access gate chain -> runtime bootstrap -> shell -> steady reconcile
```

The difference is platform responsibility:

| Concern | Mobile | Desktop |
| --- | --- | --- |
| Station selection | First-class onboarding gate | Usually profile/account context |
| Local capability owner | Rust capability kernel + native plugins | `desktop-rust` local application runtime |
| Access gate chain | Required before Station shell | Required before actor-bound business runtime |
| Foreground freshness | Event stream + reconciliation | SSE/stream + reconciliation |
| Background freshness | Push/resume delta sync | Window/process resume reconciliation |
| Secure storage | Native secure storage plugin/command | Desktop secure local storage/keychain equivalent |

---

## 8. Current Implementation Gap

Current Mobile code is still transitioning toward this lifecycle:

- `App.tsx` must model at least `station-selection -> station-handshake -> access-gate-chain -> shell`.
- Login must be promoted from Settings into an access gate renderer.
- Invite-only and fixed-user gates must use the shared Station gate protocol, not Mobile-local checks.
- Station probe currently verifies reachability; Station identity/capability handshake still needs a stronger protocol.
- Session, sync, and device runtimes are planned but not fully implemented.
- Secure storage command exists as a port; native Keychain/Keystore closure must be verified before production token storage.

---

## 9. Verification

Before changing Mobile lifecycle behavior, verify:

- `cd apps/mobile && pnpm run check:web`
- `cd apps/mobile/src-tauri && source ~/.cargo/env && cargo check`
- `cd apps/mobile && pnpm run tauri:ios:dev`

Functional verification must cover:

- first launch with no Station;
- existing Station automatic validation;
- Station add and cancel;
- Station switch clears current auth state;
- access gate chain appears before shell;
- login success enters shell;
- invite/allowlist denial blocks shell consistently;
- logout restarts access gate chain;
- app resume revalidates Station/session.
