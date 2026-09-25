# W6D - Recovery And Degraded-State Closure

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6D",
  "workstreamId": "W6D",
  "title": "Recovery and degraded-state source closure",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W6D-source",
  "journeyId": "MS-J07-source",
  "runtimeClass": "source-only",
  "writeSet": ["apps/mobile/src/components/recovery", "apps/mobile/src/features/auth", "apps/mobile/src/runtimes/recoveryProjection.ts", "tooling/acceptance/gates/mobile"],
  "readSet": ["docs/architecture/mobile", "docs/client/mobile", "packages/prototypes/mobile/chat"],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {"id": "recovery-source", "command": "pnpm --dir apps/mobile run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "recovery-focused", "command": "pnpm --dir apps/mobile run check:recovery-ui", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": ["One shell recovery host projects owner-authored degraded states", "Production triggers route through their owning lifecycle, admission, and projection contracts"],
  "failureBehavior": ["Do not inject fabricated production states", "Hide raw Station identifiers from visible recovery UI", "Required simulator recovery UI proof remains in W6D-PROOF; physical focus behavior is optional diagnostics"],
  "updatedAt": "2026-09-16T00:00:00.000Z",
  "durableEvidence": [
    {"verificationClass": "SOURCE_CHECK", "result": "PASS", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3048"},
    {"verificationClass": "SOURCE_CHECK", "result": "PASS", "ref": "apps/mobile/src/components/recovery/recoveryActions.test.ts"},
    {"verificationClass": "SOURCE_CHECK", "result": "PASS", "ref": "apps/mobile/src/runtimes/recoveryProjection.test.ts"}
  ]
}
```

## Objective

Complete truthful recovery source paths without duplicating domain authority.

## Current Snapshot

- Auth composition and source-side owner routing are complete.
- W5 now supplies runtime-owned admission, staleness, overflow, and
  session-revalidation inputs to the recovery projection.
- `RecoveryOverlayHost` remains the one app-level host, and each visible child
  stays `on-visit + none`.
- Full Mobile source verification passes; focused recovery UI regressions pass
  21/21.
- Required simulator recovery-surface proof belongs to W6D-PROOF; physical
  focus behavior remains optional diagnostics under MS-D26.
