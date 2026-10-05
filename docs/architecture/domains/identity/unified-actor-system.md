# Unified Actor System — Design

> Status: Canonical baseline with PTID-only amendment accepted on 2026-08-27.
> Owner: Architecture.
> Scope: Station (Go) ↔ Desktop (Rust + TypeScript) identity model.
> Companion: implementation history lives in PR descriptions and commit messages. This document is the design specification.

---

## 1. Purpose

Define a single Actor concept used uniformly across Station, Desktop, and any future client. The design enforces four properties:

1. Every authenticated subject is described by exactly one PTID-bearing
   canonical wire type — `ActorRef` — at every cross-process and cross-network
   boundary.
2. A desktop process may host multiple windows bound to different Actors at the same time, with no cross-binding observability at runtime.
3. Persisted per-Actor state never collides between concurrent processes or accounts.
4. Identity transitions (login, switch, unlock, logout, OAuth bridge) flow through one deterministic pipeline on every client.

Anything outside this set is explicitly out of scope; non-goals are listed in §11.

---

## 2. Concepts

### 2.1 Canonical wire type — `ActorRef`

```proto
enum ActorKind {
  ACTOR_KIND_UNSPECIFIED  = 0;
  ACTOR_KIND_PERSON       = 1;
  ACTOR_KIND_GROUP        = 2;
  ACTOR_KIND_ORGANIZATION = 3;
  ACTOR_KIND_SERVICE      = 4;
  ACTOR_KIND_APPLICATION  = 5;
  ACTOR_KIND_NODE         = 6;
}

message ActorRef {
  reserved 1;               // former actor_id; never reused
  string    ptid     = 2;   // PTID v1; federation-stable
  string    acct     = 3;   // user@host (ActivityPub webfinger); may be empty
  ActorKind kind     = 4;
}
```

Rules:

- `ptid` is the sole actor identity allowed outside Station persistence.
- `actor_id` is a Station-internal database key and never enters `ActorRef`,
  API payloads, events, JWT subject identity, Tauri commands, or client stores.
- `acct` is the canonical `user@host` projection of persisted
  `db.Actor.FederatedHandle`; request URLs, forwarded hosts, and tunnel
  endpoints MUST NOT synthesize identity. Pre-federation rows MAY leave it empty.
- `kind` MUST be present on every `ActorRef`. Receiving `ACTOR_KIND_UNSPECIFIED` from an internal trusted source MAY default to `PERSON`; from any external source it is an error.

`ActorRef` is the only structure permitted to carry identity across processes or the network. Profile bodies (`ActorProfile`, `Account`, etc.) embed an optional `ActorRef ref` field but MUST NOT be used as identity carriers.

### 2.2 Desktop projection

```
ActorRef                 — wire identity (proto)
   │
   ▼ embedded in
LocalAccount             — device-side: PIN policy, encrypted session, local data scope
   │
   ▼ referenced by
ActiveSession            — per-window, in-memory: window_label, jwt, expires_at
```

`LocalAccount` is the only persisted desktop projection. `ActiveSession` is volatile and MUST NOT be persisted.

### 2.3 Station projection

`db.Actor` is the single persisted record per Actor:

- `id: uint64` remains internal to Station repositories and adapters.
- `ptid: string` ↔ `ActorRef.ptid`
- `kind: string` shorthand of `ActorKind` (`p|g|o|s|a|n`)

The historical `Type` column (ActivityPub literal, e.g. `"Person"`) remains as legacy compatibility data and MUST NOT be read by new code. New code reads `Kind`.

---

## 3. Architecture

### 3.1 Layered topology

```
┌──────────────────────────────────────────────────────────┐
│ Client UI (React + Zustand)                              │
│   stores ──► identityPipeline ──► api (Tauri)            │
└────────────────────────────────────────────────────────┬─┘
                                                          │
                              Tauri command boundary      │
┌────────────────────────────────────────────────────────▼─┐
│ Desktop runtime (Rust)                                   │
│   interface::tauri_commands  (window-bound)              │
│        ↓ session_resolver(window) → (token, ptid)        │
│   application                    (explicit token + ptid) │
│        ↓                                                 │
│   infrastructure                                         │
│      ├ window_session_registry    (per-window binding)   │
│      ├ session_store              (per-Actor disk blob)  │
│      ├ auth_identity              (LocalAccount registry)│
│      ├ actor_bucket               (in-memory partitions) │
│      └ storage                    (paths, atomic write)  │
└────────────────────────────────────────────────────────┬─┘
                                                          │
                                Station REST + ActivityPub│
┌────────────────────────────────────────────────────────▼─┐
│ Station (Go)                                             │
│   handlers → identity middleware → actor service         │
│   db.Actor + activitypub.Identity                        │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Component responsibilities

#### Desktop — Rust

| Component | Path (under `apps/desktop/src-tauri/src`) | Responsibility |
|---|---|---|
| `domain::identity` | `domain/identity` | Canonical types: `ActorKind`, `ActorRef`, `LocalAccount`, `ActiveSession`. No I/O, no async. |
| `infrastructure::window_session_registry` | `infrastructure/window_session_registry` | `WindowSessionRegistry` — process-wide map `window_label → ActiveSession`. Single source of truth at runtime. |
| `infrastructure::session_store` | `infrastructure::session_store` | Target per-Actor session scope is PTID; current numeric-keyed files are migration input only. |
| `infrastructure::auth_identity` | `infrastructure/auth_identity` | Persisted `LocalAccount` registry: `account/identities.json` (PIN-encrypted blobs included). |
| `infrastructure::actor_bucket` | `infrastructure/actor_bucket` | Bucket-id sanitization shared by in-memory partitioned stores. |
| `application::session_resolver` | `application/session_resolver` | The only boundary for obtaining a session access context; target identity output is `(token, ptid)`. |
| `application::auth` / `oauth2` / `account` | `application/{auth,oauth2,account}` | Pipeline owners for login, OAuth bridge, switch, unlock, logout. They — and only they — bind/unbind the registry. |
| `interface::tauri_commands::*` | `interface/tauri_commands` | Boundary. Every user-domain command takes `tauri::Window` and resolves identity via `session_resolver` before delegating to application. |

#### Desktop — TypeScript

| Component | Path (under `apps/desktop/src`) | Responsibility |
|---|---|---|
| `services/identityPipeline` | `services/identityPipeline.ts` | Ordered, idempotent identity-change pipeline; sole entry for state-mutating reactions to identity changes. |
| `services/identityHandlers` | `services/identityHandlers.ts` | Default handlers, registered at boot: `clear-zustand-stores`, `clear-localstorage-caches`, `refresh-current-session`. |
| `services/identity_event` | `services/identity_event.ts` | Tauri-side `auth.identity_changed` bridge; deduplicates the originator window via `LOCAL_IDENTITY_FLAG`. |
| `store/*` | `store` | Each top-level Zustand store implements `reset()`; identity-aware stores also implement `hydrate(actorPtid)`. |
| `services/desktop_api` | `services/desktop_api.ts` | Sole binding to Tauri commands. `AccountIdentity` is the canonical TS Actor handle. |

#### Station — Go

| Component | Path (under `apps/station/frame/touch`) | Responsibility |
|---|---|---|
| `model/db.Actor` | `model/db/actor.go` | Persisted Actor row, including `Kind`. |
| `activitypub/identity` | `activitypub/identity` | PTID generation and resolution. |
| `actor` | `actor` | `SignUp`, `Login`, profile, identity-bearing helpers. `ProtoActorRef(*db.Actor)` is the canonical `ActorRef` builder. |
| `session/handler` | `session/handler` | JWT mint + verify; populates `actor_ref` on responses. |

---

## 4. Contracts and invariants

These are normative. Code reviews and lints SHOULD enforce them.

### C-1 · Window-bound resolution at the command boundary

For every Tauri command that touches user-domain data:

1. The command MUST accept `tauri::Window`.
2. The command MUST resolve a token and PTID through `session_resolver`; numeric
   translation, when still required, stays behind a Station repository adapter.
3. Application functions MUST NOT call `state.session.lock()` directly. They accept `token: &str` (or a pre-built `AccessContext`) as an explicit parameter.

### C-2 · Resolution order

`session_resolver` resolves only
`state.sessions.get(window.label())`, the authoritative per-window
`ActiveSession`. Missing binding is a typed unauthenticated error; it never
falls back to process-global identity.

Every command path that mutates identity (login / switch / unlock / OAuth
bridge) MUST bind the window session before returning.

### C-3 · Per-Actor persistence

Target user-domain state on disk is keyed by PTID:

| Path | Scope | Owner |
|---|---|---|
| `auth/sessions/{ptid}.json` | per-Actor | `infrastructure::session_store` |
| `account/identities.json` (registry of per-Actor encrypted sessions) | OS-user | `infrastructure::auth_identity` |
| `data/db/users/{ptid}/*.db` | per-Actor | `infrastructure::storage::resolve_database_path` |
| `config/providers/users/{ptid}/override.yaml` | per-Actor | `application::provider::state` |
| `config/settings.json` | OS-user (intentionally global) | `infrastructure::storage::settings_*` |

There MUST NOT exist any single shared file at OS-user scope that holds per-Actor state, other than `identities.json` (itself a multi-entry registry).

### C-4 · In-memory store partitioning

Process-wide stores that hold user-domain data MUST be partitioned by non-empty
PTID. Public APIs take `ptid: &str`; empty identity is a typed error and must
never fall back to a shared default bucket.

This rule applies to:

- `application::chat::ChatStores`
- `application::agents::AgentStores`
- `infrastructure::profile_store::ProfileStores`
- `infrastructure::timeline_store::TimelineStores`

New modules introducing in-memory caches MUST follow the same pattern.

### C-5 · Identity-mutating commands emit `auth.identity_changed`

Every command that successfully mutates the active identity (`auth_login`, `auth_logout`, `account_switch`, `account_unlock`, `ensure_station_session`, `save_oauth_callback`) MUST:

1. Update the bound `ActiveSession` (bind / unbind in `WindowSessionRegistry`).
2. Persist via `session_store::save / delete`.
3. Emit `auth.identity_changed` with
   `IdentityChangedPayload { reason, actor_ptid, login_method }`.

The originating window's frontend MUST set `LOCAL_IDENTITY_FLAG = '1'` in `sessionStorage` before invoking the command, so the listener path skips a duplicate pipeline run in the originating window.

### C-6 · Identity pipeline runs in both directions, exactly once per window

Both originator and listener windows MUST run `runIdentityPipeline(payload)` once per identity change. Handlers MUST be idempotent: an unintended second run on the same window MUST NOT corrupt state. The default handlers (clear stores, clear localStorage prefixes, refresh session) satisfy this property.

### C-7 · No process-global session authority

`AppState.session` is removed. Debug HTTP gateways must receive an explicit
PTID-scoped session binding and cannot restore process-global identity.

### C-8 · PTID-only wire hard cut

Current clients and Station use `ActorRef.ptid` as the sole cross-process actor
identity. Numeric actor fields and aliases are removed atomically, their former
Proto tags are reserved, and numeric-subject JWTs fail closed. No compatibility
adapter, dual-write, or legacy identity reader remains.

---

## 5. Data flows

### 5.1 Password login

```
[ui] LoginPage
  ① markLocalIdentityAction()                  // sets LOCAL_IDENTITY_FLAG
  ② api.authLogin(window)
       [rust] auth_login(window)
         ↳ application::auth::login(token, …)
         ↳ state.sessions.bind(label, ActiveSession)        — C-2 step 1
         ↳ session_store::save(ptid, token, Password)      — C-3
         ↳ state.session.lock() = Some(...)                — legacy mirror, C-7
         ↳ identity_event::emit(Login)                     — C-5
  ③ runIdentityPipeline({ reason:'login', actorPtid, … })  — C-6 originator
       ↳ refresh-current-session validates the window-bound token
         without issuing a takeover session

[other windows]
  ④ Tauri event auth.identity_changed
     ↳ identity_event bridge sees no flag
     ↳ runIdentityPipeline(...)                            — C-6 listener
```

### 5.2 Account switch (multiple windows in one process)

Same shape as login. `account_switch` mutates only the originating window's binding; sibling windows keep their previous bindings and only run the pipeline.

### 5.3 Logout

```
[ui]
  ① markLocalIdentityAction()
  ② api.authLogout(window)
       ↳ state.sessions.unbind(label)
       ↳ session_store::delete(ptid)
       ↳ identity_event::emit(Logout)
  ③ runIdentityPipeline({ reason:'logout', actorPtid:null }) — clears, no rehydrate
```

### 5.4 Restore on startup

```
[rust] AppState::new
  ↳ session_store::migrate_legacy()       // idempotent; absorbs pre-PR-4 disk shape

[ui] App boot
  ① api.authRestoreSession(window)
       ↳ identities.json → active account → ptid
       ↳ session_store::load(ptid) → token
       ↳ in-memory guard: refuse if state.session is bound to a different ptid
       ↳ state.sessions.bind(label, ActiveSession)
```

The in-memory cross-process guard prevents process B from overlaying its restored session onto an already-loaded session belonging to process A.

### 5.5 OAuth bridge

```
oauth_callback(window)
  ↳ exchange third-party code for station JWT
  ↳ session_store::save(ptid, jwt, OauthBridge)
  ↳ state.sessions.bind(label, ActiveSession)
  ↳ identity_event::emit(OauthBridge)
```

`ensure_station_session` later loads only the `OauthBridge`-source blob for the active account. Password and OAuth tokens never alias each other.

---

## 6. Multi-window semantics

A desktop process MAY host multiple windows; each window owns one `ActiveSession`.

Guaranteed properties:

- Two windows in the same process bound to different Actors are isolated at the runtime layer (`session_resolver`) and in PTID-partitioned stores.
- Two windows in different processes never collide on disk because all per-Actor disk paths are keyed by PTID.
- The OS-user-scoped account registry (`identities.json`) is multi-process-safe via atomic-rename writes; readers tolerate stale views; the in-memory cross-process guard rejects loading a foreign session over a live one.

Properties NOT yet guaranteed (see §11):

- A window opened before `auth_restore_session` has bound it has no `ActiveSession` and reads via the C-2 fallback. Closing C-7 removes this hole.
- Concurrent writes to `identities.json` by two processes are serialized via atomic-rename but MAY lose later-of-two updates; conflict detection is not implemented.

---

## 7. Frontend identity pipeline

### 7.1 Handler protocol

```ts
type IdentityChangePayload = {
  reason: 'login' | 'logout' | 'switch' | 'unlock' | 'oauth_bridge';
  actorPtid: string | null;
  loginMethod: string | null;
};

type Handler = (p: IdentityChangePayload) => void | Promise<void>;
```

Handlers run sequentially in registration order. The first thrown error halts the pipeline. Per-handler timing is logged.

### 7.2 Default handlers (registered at boot)

1. `clear-zustand-stores` — calls `reset()` on every top-level store; for non-logout, follows up with `hydrate(actorPtid)` where supported.
2. `clear-localstorage-caches` — removes keys with prefixes `user:`, `chat:`, `friend:`, `group:`, `profile:`, `accountSession:`, `socialChat:`. The prefix list is the contract: any new module that introduces actor-scoped cached keys MUST register its prefix here.
3. `refresh-current-session` — for non-logout and non-switch transitions,
   validates the current window-bound token through `api.authValidateToken({})`
   and writes the result back into `useSessionStore`. It MUST NOT call
   takeover-style persisted-session restore after a successful login, OAuth
   bridge, or PIN unlock because that would revoke the session just issued to
   the same window.

### 7.3 Originator / listener deduplication

```
Originator window
  set LOCAL_IDENTITY_FLAG = '1'
  invoke Tauri command
  on success → runIdentityPipeline(payload)
  Tauri event arrives → bridge sees flag → remove flag → return

Listener window
  Tauri event arrives → bridge sees no flag → runIdentityPipeline(payload)
```

Idempotency note: if the flag is missed (process crash between `markLocalIdentityAction` and the Tauri call), the originator runs the pipeline twice. C-6 makes this safe.

---

## 8. Cross-platform proto contract

`ActorRef` and `ActorKind` are defined in `model/domain/actor/actor.proto`. The
target contract is:

- `Actor`, `ActorProfile`, and every identity-bearing response embed `ActorRef` (directly or via `ref`).
- Client-facing `ActorRef` contains PTID, `acct`, and kind; numeric identity is
  absent and its former tag is reserved.
- Existing numeric fields are migration residue to delete in the W1 hard cut.
  Station may translate PTID to numeric primary keys only inside persistence
  adapters; it must never emit those keys to a client or another process.
- New fields are appended; tags are never reused.

Generated bindings:

- Go: `apps/station/frame/touch/model/*.pb.go` via `model/build.sh` (`protoc-gen-go`).
- Rust (desktop): prost via `apps/desktop/src-tauri/build.rs`.
- TypeScript: connect-es via `packages/model` (when adopted by frontend).

---

## 9. Persistence layout (desktop)

```
$APP_SUPPORT/peers-touch/desktop/
├── auth/
│   └── sessions/{ptid}.json       ← { ptid, token, saved_at, source }
├── account/
│   └── identities.json            ← LocalAccount registry + encrypted sessions
├── data/
│   └── db/users/{ptid}/*.db       ← per-Actor SQLite
├── config/
│   ├── providers/users/{ptid}/override.yaml
│   └── settings.json              ← OS-user-global, intentional
└── cache/avatars/                 ← content-addressed
```

`session_store::migrate_legacy()` runs at boot and absorbs pre-PR-4 single-file blobs into the per-Actor layout, removing the legacy files. Idempotent; safe to call repeatedly.

---

## 10. Migration policy

- **Desktop session files**: numeric-identity files are deleted and users
  reauthenticate. URL or account-name inference must not migrate them into a
  PTID scope.
- **Station `db.Actor.Kind`**: GORM `AutoMigrate` adds the column with default `'p'`. No destructive backfill.
- **Proto**: the approved PTID-only hard cut reserves removed field numbers and
  does not bump the project protocol version.
- **JWT subject**: target subject identity is PTID. Numeric-subject JWTs are
  migration input only and cannot activate a target Mobile session.

---

## 11. Open issues and non-goals

This section records current implementation residue that must be removed before
the target identity contract is complete.

| # | Issue | Status |
|---|---|---|
| 1 | `AppState.session` legacy global is still read by `session_resolver` as a fallback (C-2 step 2). A window opened before `auth_restore_session` binds it inherits the global, weakening multi-window isolation in that narrow window of time. | Planned: removed once `http_gateway` learns about windows. |
| 2 | Three parallel `ActorKind` definitions exist: prost-generated (Rust), `domain::identity::ActorKind` hand-coded (Rust), `identity.AccountType` hand-coded (Go). Bridges (`KindFromProto`, `ActorKindFromShorthand`) cover the runtime gap, but the duplication is real. | Planned: collapse hand-coded enums into the generated types in a follow-up. |
| 3 | JWT `subject_id` still carries bare numeric `actor_id`. | Blocking migration: mint PTID subject identity before target Mobile session activation. |
| 4 | `account_type` legacy proto string field has no scheduled removal. | Planned: remove one release after every client confirms adoption of `kind`. |
| 5 | The `clear-localstorage-caches` prefix list is hand-maintained. New cached keys not on the list will leak across identity changes, with no automated detection. | Mitigation: ESLint rule or boot-time prefix registry. Out of scope here. |
| 6 | No automated end-to-end test exercises a real two-window two-account scenario through the Tauri runtime. Coverage today is unit / type / build only. | Planned: WebDriver-based smoke under `tooling/`. |
| 7 | The current `__default__` bucket absorbs empty identity. | Blocking migration: remove fallback and return a typed missing-PTID error. |

These items are not regressions of this design; they are the explicit residue of a phased migration. Future work tracks them as separate PRs.

---

## 12. Reference implementation

The implementation is delivered as a sequence of nine PRs covering Rust runtime hardening, frontend pipeline introduction, proto extensions, and Station Go schema. PR descriptions and commit messages document the change history.

This document is the design specification; it intentionally does not duplicate that history.

---

## 13. Related Sources

- `docs/knowledge/invariants/actor-identity-boundary.md` is the enforcement
  rule for PTID-only process and network boundaries.
- `docs/architecture/platform/client/mobile/` applies the same identity boundary to Station
  selection, OAuth, session activation, caches, routes, and durable commands.
- `docs/architecture/platform/runtime/service-coordination.md` defines signed
  `station_peer_id` pinning; actor PTID and Station peer ID are distinct scopes.
