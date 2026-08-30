# Mobile Shell — 产品状态模型

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-27
> **Owner**: Mobile Product Team

---

## 1. Top-Level States

```text
app-boot
  -> station-selection
  -> station-handshake
  -> access-gate-chain
  -> runtime-critical
  -> shell

shell -> station-change -> station-selection
shell -> logout -> access-gate-chain
shell -> background -> resume -> runtime-critical|shell|access-gate-chain
```

| State | User sees | Allowed actions | Exit condition |
|---|---|---|---|
| `app-boot` | Stable launch feedback | Cancel is not applicable | Local guards and capability ports ready |
| `station-selection` | Registry and connection states | Add/select/remove/retry | Reachable target selected |
| `station-handshake` | Verifying target | Retry/change Station | Compatible Station confirmed |
| `access-gate-chain` | Current Station-owned gate | Submit/cancel/change Station | Access granted or terminal denial |
| `runtime-critical` | Session preparation or blocking failure | Retry/logout | PTID-bearing session and navigation host are ready |
| `shell` | Chats/Moments/Contacts/Me | Normal product actions | Logout, Station change, background, revocation |
| `background` | OS-owned app state | Notification action | Foreground resume |
| `resume` | Stale/reconciling indication | Cancel long action/logout | Session and required projections reconciled |

## 2. Navigation States

```text
shell-tab(chat|moments|contacts|me)
  -> detail(conversation|contact|group|moment|setting)
  -> overlay(bottom-sheet|modal)
```

- Primary tabs are `on-visit + none` by default.
- Dynamic details are `on-visit + none`; bounded LRU requires an explicit later decision.
- Runtime projections remain alive independently of visible pages.
- Closing an overlay restores focus and prior scroll context.

## 3. Shared Async States

Every command-capable surface distinguishes:

- `idle`
- `pending`
- `committed`
- `failed-retryable`
- `failed-terminal`
- `unknown-outcome`
- `cancelled`
- `stale`
- `reconciling`

`unknown-outcome` is mandatory for a write that may have committed while its
response was lost. It cannot transition to automatic replay without an
idempotency contract.

```text
unknown-outcome
  -> reconciling
     -> committed
     -> failed-terminal
     -> failed-retryable (only when Station proves no commit)
     -> unknown-outcome (still unresolved)
```

Restart, resume, and transport reconnect do not erase `unknown-outcome`.
Resolution is scoped to the original Station and actor PTID. A different
Station or actor cannot consume or replay it. A new process generation may
rebind it only after exact scope and session validation; stale callbacks from
the originating generation remain rejected.

## 4. Shell Entry And Degradation

The following are non-degradable shell-entry conditions:

- current Station handshake verifies the expected `station_peer_id` and compatible capabilities;
- Station access decision is granted;
- secure session is valid and contains a non-empty actor PTID;
- the lifecycle generation and navigation host are ready.

Social, group, Moments, notification, profile, and settings projections are
module-degradable. Their bootstrap failure renders a module-local unavailable
state after Shell entry; it does not fabricate empty data or reuse a prior
generation. Authentication, PTID resolution, secure credential cleanup, and
generation fencing are never degradable.

`commandRuntime` is shell-degradable but mutation-critical: if its encrypted
ledger cannot open or validate, read-only projections may remain visible while
all Station mutations stay disabled with an explicit recovery state.

## 5. Surface State Contracts

| Surface | Required visible states | Allowed recovery |
|---|---|---|
| Station selection | empty, checking, reachable, unreachable, identity-mismatch, capability-incompatible | add, retry, remove, replace, inspect friendly identity |
| Access gate | loading, action-required, pending, blocked, failed, expired | submit, cancel, retry, change Station |
| OAuth | launching, awaiting-provider, callback-received, following-gate, cancelled, expired, replay/mismatch | retry provider, use Email, change Station |
| Conversation list | loading, empty, ready, stale, unavailable | retry/reconcile, search, start from Contacts |
| Conversation detail | history-loading, ready, sending, upload-progress, failed, unknown-outcome, permission-denied | retry when safe, check status, edit/discard draft, back |
| Contacts/groups | loading, empty, no-results, request-pending, duplicate, remote-unavailable, role-denied | retry, refine search, inspect profile, back |
| Moments | loading, empty, filtered-empty, ready, policy-hidden, unavailable, publish-pending, rollback | refresh, retry, edit/discard draft |
| Me/settings | loading, ready, dirty, saving, saved, conflict, permission-required, failed | save, discard, stay, open system settings, retry |
| Runtime capacity | command-ledger-full, event-overflow-reconciling | continue read-only, resolve pending work, retry later |

Chat and Moments drafts are device-local durable state. Tab/detail unmount and
background do not discard them; process restart restores the last complete
draft transaction. Logout or Station replacement requires an explicit choice to
discard or retain quarantined drafts for the original Station/PTID.

## 6. Required Recovery

| Failure | Durable state | Recovery |
|---|---|---|
| Station unavailable | Registry and draft address | Retry or change target |
| OAuth cancelled | Selected Station and access attempt when valid | Retry provider or Email login |
| Session revoked | Station registry only | Clear secure session and re-authenticate |
| Event stream lost | Last committed projection and cursor | Mark stale; reconnect and reconcile |
| Send failed | Draft/outbox item | Retry, edit, or discard |
| Write response lost | Durable command in `unknown-outcome` | Query command status or authoritative readback before retry |
| Upload failed | Draft and successful attachments | Retry failed attachment or remove |
| Resume sync failed | Existing projection marked stale | Retry while keeping unavailable actions disabled |
| Teardown timeout | Old generation hidden and fenced | Retry cleanup; never restore old Shell |
| Secure credential deletion failed | Shell-blocking teardown failure | Retry deletion or explicit local reset |
