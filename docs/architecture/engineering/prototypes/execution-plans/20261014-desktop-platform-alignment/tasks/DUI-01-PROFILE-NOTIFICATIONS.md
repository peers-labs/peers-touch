# DUI-01 - Profile and notification closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "desktop-platform-alignment-20261014",
  "taskId": "DUI-01-PROFILE-NOTIFICATIONS",
  "workstreamId": "DUI-SHELL",
  "title": "Close C1-C9 through canonical profile and notification owners",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dui-profile-notifications",
  "journeyId": "DUI-C1-C9",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/notification",
    "apps/station/app/subserver/social",
    "apps/station/frame/touch",
    "model/domain/actor",
    "packages/locales",
    "packages/prototypes/desktop/shell",
    "docs/client/desktop",
    "docs/client/common/ui-identity/frontend-component-tree-registry.md",
    "docs/architecture/domains/notification/notification-architecture.md",
    "docs/architecture/engineering/prototypes/execution-plans/20261014-desktop-platform-alignment",
    "tooling/acceptance",
    "tooling/scripts/local-dev/workflow-tool-intent.mjs",
    "tooling/scripts/local-dev/workflow-tool-intent.test.mjs"
  ],
  "readSet": [
    "docs/architecture/domains/notification/notification-architecture.md",
    "docs/client/desktop/runtime-projections.md",
    "docs/client/common/ui-identity"
  ],
  "budgets": {"focusedCheckSeconds": 1200, "functionalRunSeconds": 1800, "cleanupSeconds": 180},
  "checks": [
    {"id":"dui-profile-notification-source","command":"pnpm --dir apps/desktop run check","verificationClass":"SOURCE_CHECK"},
    {"id":"dui-profile-notification-functional","command":"pnpm --dir apps/desktop exec vitest run src/components/settings/accountIdentityPresentation.test.ts src/kernel/identityRuntime.test.ts src/runtimes/settingsRuntime.test.ts src/store/settings.test.ts src/store/relationships.test.ts src/store/profile.test.ts src/store/notification.test.ts src/store/pushDevices.test.ts","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"dui-profile-notification-proof","command":"python3 tooling/scripts/acceptance-run.py --gate desktop-check","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "C1-C6 read and mutate one revision-fenced Actor profile projection",
    "Avatar and cover use Native OSS flows and unsupported cover history is absent",
    "C7-C9 use authoritative notification list, decisions, category preferences, push registrations, and unread reconciliation",
    "No shell profile or notification control depends on mock data or localStorage"
  ],
  "failureBehavior": [
    "Reject stale profile or preference revisions without overwriting newer state",
    "Do not invent provider, locale, identity, notification category, or push registration data",
    "Keep runtime-backed state in the owning runtime/store"
  ],
  "updatedAt": "2026-10-14T20:05:00.000Z"
}
```

## Objective

Finish the user identity and notification journeys without introducing a
second profile or notification authority.

## Current Snapshot

- C1-C6 use the canonical profile store with explicit Save/Discard and native OSS upload.
- C7 has post-commit Social notification production; current-source native proof remains required.
- C8 reads redacted push registrations; registration mutations remain Mobile-owned.
- C9 reconciles authoritative counts through the Social runtime.
- C1-C9 remain formally open.
