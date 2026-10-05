# MOBILE-FRONTIER - Preserved Mobile Source Frontier

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "MOBILE-FRONTIER",
  "workstreamId": "MOBILE-FRONTIER",
  "title": "Preserve the completed pre-amendment Mobile source frontier",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "mobile-feature-frontier-source",
  "journeyId": "MS-J01..MS-J07-source-frontier",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile",
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/social",
    "apps/station/frame/touch/accessgate",
    "model/domain/chat",
    "model/domain/mobile",
    "model/domain/social",
    "packages/locales",
    "packages/messaging-core",
    "docs/architecture/platform/client/mobile/execution-plans/20260827-mobile-shell-implementation"
  ],
  "readSet": [
    "docs/architecture/platform/station/access",
    "docs/architecture/engineering/api-governance",
    "docs/architecture/domains/chat/messaging",
    "docs/architecture/platform/client/mobile",
    "docs/architecture/domains/social/runtime",
    "docs/client/mobile"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 25200,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "mobile-feature-frontier-source",
      "command": "pnpm --dir apps/mobile run check:web && node tooling/scripts/plan/planctl.mjs validate --plan docs/architecture/platform/client/mobile/execution-plans/20260827-mobile-shell-implementation/plan.md --repo-root .",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "The 2026-09-17 source audit and all durable focused evidence remain preserved",
    "Every then-known accepted-design gap is recorded without fabricating an owner",
    "The accepted v1.1 amendment gaps are delegated to explicit dependency-backed Tasks",
    "No formal Gate or user-acceptance claim is inferred from this source snapshot"
  ],
  "failureBehavior": [
    "Do not treat this preserved snapshot as proof that v1.1 source work is complete",
    "Do not rewrite or discard its durable evidence during Plan recovery",
    "Do not invent Access Gate, Group, Social, push, background-task, private-media, or account-preference semantics",
    "Preserve unrelated dirty files and never bulk-stage, stash, reset, or create compatibility paths"
  ],
  "updatedAt": "2026-09-17T03:03:00.000Z"
}
```

## Objective

Preserve the completed 2026-09-17 source-frontier audit and its evidence as the
baseline from which the accepted v1.1 closure Tasks continue.

## Current Snapshot

- Prior source slices closed Access recovery, native fencing, Moments recovery,
  encrypted-media rendering, and Settings recovery.
- The accepted v1.1 amendment now decomposes every formerly undefined owner
  contract into W2, W2-TRANSPORT, W5-OWNER, W5-SOCIAL, W6A, W6B, W6C, and W7.
- This completed snapshot does not claim those new Tasks are done.

## Execution Order

1. Preserve the durable audit evidence.
2. Execute the explicit v1.1 source and functional Tasks in DAG order.
3. Complete W8 semantic hard cut.
4. Hand off to `MOBILE-FRONTIER-PROOF`.

## Concurrency Decision

- Hybrid execution is allowed only for disjoint owner-layer write sets with
  frozen contracts and independent focused checks.
- MF-A, MF-B, and MF-C stay in one serial integrator lane because they share
  `App.tsx`, auth-session state, lifecycle launch transitions, and Shell
  admission semantics.
- MF-D through MF-J may split only after that launch contract is frozen; each
  lane must reserve a disjoint page/store/runtime write set and return focused
  regression evidence before integration.
- MF-K owns Access/Session runtime and native OAuth files; MF-L owns Chat
  feedback/layout files; MF-M owns Contacts/Group files; MF-N owns native
  command-ledger and recovery files.
- `runtimeRegistry.ts`, `mobileCommands.ts`, locale files, this Task, generated
  outputs, commits, and final verification remain integrator-owned; lane changes
  cross those boundaries only through an explicit reconcile.
- Shared proto, plan, generated outputs, lockfiles, and integration remain
  integrator-owned and serial.
- Formal Acceptance, deployment, and user-acceptance lanes remain disabled
  throughout this Task.

## Clause Audit Matrix

| Slice | Journey clauses | Classification | Owner / write set |
|---|---|---|---|
| MF-A station truth | MS-J01 truthful unknown/checking state, strict Station origin, signed handshake, explicit identity replacement | source-complete; focused tests pass | `apps/mobile/src/features/station`, `apps/mobile/src-tauri/src/commands/station.rs`, `apps/mobile/src/App.tsx` |
| MF-B shell admission | MS-J01 final grant plus valid PTID session and critical runtime readiness before Shell | source-complete; native business transport remains parked | `apps/mobile/src/App.tsx`, `apps/mobile/src/runtimes`, Mobile Rust OAuth |
| MF-C revoked restore | MS-J02 revoked/expired restore clears the scoped secure session before returning to the gate chain | source-complete; focused tests pass | `apps/mobile/src/runtimes/authRuntime.ts`, focused auth tests |
| MF-D chat settings | MS-J03 settings, typing feedback, and composed keyboard/panel occlusion | source-complete; focused tests pass | `apps/mobile/src/pages/ChatPage.tsx`, `apps/mobile/src/pages/chat` |
| MF-E group pending | Resulting-group entry, membership confirmation, request fencing, and search distinctions | source-complete; focused tests pass | `apps/mobile/src/features/group`, `apps/mobile/src/pages/ContactsPage.tsx`, `apps/mobile/src/pages/chat` |
| MF-F Moments refresh | MS-J05 ready feed exposes a user-triggered refresh while retaining visible content | source-complete; focused tests pass | `apps/mobile/src/pages/MomentsPage.tsx`, focused Moments tests |
| MF-G Settings truth | MS-J06 Station trust uses `identityVerified`, and notification controls expose native permission-required state | source-complete; focused tests pass | `apps/mobile/src/pages/SettingsPage.tsx`, `apps/mobile/src/pages/settings`, focused Settings tests |
| MF-H recovery detail | MS-J07 durable Friend Request recovery identifies each affected command and state | source-complete; focused tests pass | `apps/mobile/src/components/recovery`, `apps/mobile/src/runtimes/recoveryProjection.ts`, focused recovery tests |
| MF-I capacity admission | Record and byte capacity close writes while preserving readback | source-complete; focused tests pass | `apps/mobile/src/runtimes`, Mobile Rust ledger |
| MF-J native readiness | W7 native listener or initial-observation failure rejects runtime readiness | source-complete; focused tests pass | `apps/mobile/src/runtimes/nativeLifecycleBridge.ts`, focused native/runtime tests |
| MF-K access/session ownership | Separate Access/Session owners, native metadata, refresh/revocation fencing | source-complete; focused tests pass | `apps/mobile/src/runtimes`, Mobile Rust OAuth |
| MF-L Chat feedback/layout | Typing recovery and one measured occlusion model | source-complete; focused tests pass | Chat page/layout |
| MF-M Contacts/Group convergence | Search, request, create, and membership states | source-complete; focused tests pass | Contacts/Group |
| MF-N byte capacity | Native record/byte exhaustion projected into admission and recovery | source-complete; focused tests pass | Rust ledger, Mobile runtimes |
| Formerly parked contracts | Native credential-attaching business transport; generic gates/finalization; forward/delete; Group roles/mute; Social block/list/status; filtered-empty; full account preferences; APNs/FCM; BGTaskScheduler; native media picker | accepted in v1.1 and delegated to explicit pending Tasks | Named architecture owners |

## Ready Queue

- This completed snapshot does not select current work. `planctl next` owns the
  prepared package frontier after Plan approval.

## Completed Queue

- MF-A through MF-N are source-complete with focused regressions.

Source implementation and focused regression checks are allowed. Broad
Acceptance, deployment, and user-acceptance preparation remain outside this
Task.
