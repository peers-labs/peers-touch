# W2-RECOVERY - Access Attempt Recovery

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W2-RECOVERY",
  "workstreamId": "W2",
  "title": "Access decision refresh and attempt cancellation recovery",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W2-recovery-source",
  "journeyId": "MS-J01-recovery-source",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/auth",
    "apps/mobile/src/runtimes/authRuntime.ts",
    "apps/mobile/src/App.tsx",
    "apps/station/frame/touch/accessgate",
    "packages/locales/en/common.json",
    "packages/locales/zh-CN/common.json"
  ],
  "readSet": [
    "docs/architecture/mobile",
    "model/domain/access_gate/access_gate.proto",
    "apps/station/frame/touch/actor_handler.go"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "mobile-access-recovery-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/auth/AccessGateHost.test.ts src/features/auth/authSession.test.ts src/features/auth/authRuntime.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "station-access-attempt-cancellation",
      "command": "cd apps/station && go test ./frame/touch/accessgate/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-access-source",
      "command": "pnpm --dir apps/mobile run check",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Mobile can refresh a Station-owned access decision without fabricating gate payloads",
    "Users can cancel a live access attempt from pending, action-required, blocked, or failed recovery states",
    "Retry and Station-change recovery remain visible and session-safe"
  ],
  "failureBehavior": [
    "Do not invent generic terms, device, or custom gate submission payloads",
    "Do not infer non-OAuth credential finalization semantics",
    "Generic gate completion remains blocked in W2"
  ],
  "updatedAt": "2026-09-17T02:31:30Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/features/auth/authSession.test.ts"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/features/auth/authRuntime.test.ts"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/features/auth/AccessGateHost.test.ts"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/station/frame/touch/accessgate/attempt_store_test.go"
    }
  ]
}
```

## Objective

Complete the already-defined Access Attempt recovery path independently of the
still-undefined generic gate submission and non-OAuth finalization contracts.

## Current Snapshot

- Station already exposes access-decision refresh and attempt cancellation.
- Mobile does not expose either recovery transport to the user.
- Station cancellation currently excludes blocked and failed live attempts.
- Generic gate payload and finalization semantics remain
  `DESIGN_AMENDMENT_REQUIRED` in W2.

## Source Closure

- Mobile refreshes the current Station-owned decision through
  `/actor/access/decision` and rejects a mismatched attempt identity.
- Station change cancels any active native OAuth attempt, then cancels the
  Station access attempt through `/actor/access/cancel`; failure preserves the
  selected Station and current decision for inline retry.
- Pending, blocked, and failed decisions expose same-attempt refresh and
  cancel-before-change recovery without constructing gate payloads.
- Station cancellation accepts pending, action-required, blocked, and failed
  attempts while retaining granted, cancelled, and expired terminal states.

## Verification Snapshot

- Focused Mobile auth suite: 33/33 PASS.
- Station access-gate suite: PASS.
- `pnpm --dir apps/mobile run check`: PASS, including Web/TypeScript, Vite,
  offline Rust, and iOS project checks.
- Formal runtime and Acceptance proof remains deferred until the source
  implementation frontier is complete.

## Concurrency Decision

- Execute serially because Mobile recovery state, Station cancellation
  semantics, copy, and focused regression coverage form one user-visible flow.
- The integrator owns this Task, Plan lifecycle, shared locale files, and final
  source checks.
