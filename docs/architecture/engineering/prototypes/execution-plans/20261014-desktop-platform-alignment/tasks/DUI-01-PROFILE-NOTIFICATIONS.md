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
    "tooling/scripts/local-dev/workflow-tool-intent.test.mjs",
    "tooling/make/acceptance.mk",
    "tooling/scripts/acceptance-pipeline-audit.py",
    "tooling/scripts/acceptance-pipeline-audit-test.py"
  ],
  "readSet": [
    "docs/architecture/domains/notification/notification-architecture.md",
    "docs/client/desktop/runtime-projections.md",
    "docs/client/common/ui-identity"
  ],
  "budgets": {"focusedCheckSeconds": 1200, "functionalRunSeconds": 2400, "cleanupSeconds": 180},
  "checks": [
    {"id":"dui-profile-notification-source","command":"pnpm --dir apps/desktop run check","verificationClass":"SOURCE_CHECK"},
    {"id":"dui-profile-notification-unit","command":"pnpm --dir apps/desktop exec vitest run src/components/settings/accountIdentityPresentation.test.ts src/kernel/identityRuntime.test.ts src/runtimes/settingsRuntime.test.ts src/store/settings.test.ts src/store/relationships.test.ts src/store/profile.test.ts src/store/notification.test.ts src/store/pushDevices.test.ts","verificationClass":"SOURCE_CHECK"},
    {"id":"dui-profile-notification-contract","command":"make acceptance-validate DOMAIN=station-access","verificationClass":"SOURCE_CHECK"},
    {"id":"dui-profile-notification-suite-source","command":"python3 tooling/acceptance/gates/desktop/profile_notifications_suite_test.py","verificationClass":"SOURCE_CHECK"},
    {"id":"dui-profile-notification-python-environment","command":"make acceptance-python-setup","verificationClass":"SOURCE_CHECK"},
    {"id":"dui-profile-notification-functional","command":"python3 tooling/acceptance/gates/desktop/profile_notifications_journey.py","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"dui-profile-notification-proof","command":"python3 tooling/scripts/acceptance-run.py --gate desktop-profile-notifications-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "dui-profile-notification-functional",
    "scenarioIds": ["desktop-account-profile", "desktop-notification-center"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
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
  "updatedAt": "2026-10-15T08:00:00.000Z"
}
```

## Objective

Finish the user identity and notification journeys without introducing a
second profile or notification authority.

## Current Snapshot

- C1-C6 use the canonical revision-fenced profile store with explicit
  Save/Discard, Native OSS upload, conflict preservation, and authoritative
  reload.
- C7 consumes post-commit Social notifications through trusted Native pointer
  actions, inline decisions, search, and pagination.
- C8 persists all category preferences and reads redacted push registrations;
  registration mutations remain correctly Mobile-owned.
- C9 reconciles authoritative unread counts through the Social runtime and
  proves sender/receiver visibility.
- The shell prototype accepts an injected notification projection and defaults
  to the truthful empty state; it contains no embedded notification fixtures.
- C1-C9 are closed by current-source functional and formal Native Acceptance.

## Runtime Proof

The development Journey and formal Gate share the same Profile and notification
actions. The Environment owner attests the existing remote Station without a
reset, prepares two persistent fixture installations, and launches and logs in
each client once after the Native runtime cell is leased. Both scenarios attach
to that Suite. Native actions, receiver-visible assertions, source bindings and
terminal cleanup precede publication of the complete result generation.

Make selects Python 3.11 or newer, rebuilds an incompatible cached environment,
installs the pinned Acceptance requirements, and places that interpreter first
in the Gate subprocess PATH. The context bootstrap continues to reject system
Python and user site packages.

The completion boundary requires `desktop-profile-notifications-e2e` to emit
`PASS/DONE/PROVEN` with `phase=DUI-C1-C9`, exact source and binary identity,
two distinct authenticated actors, one Suite provisioning run, two client
launches, a 0.5 warm-reuse rate, receiver-visible assertions for both
scenarios, immutable screenshots, secret scan, and terminal cleanup. Static,
API-only, screenshot-only, or lifecycle-only evidence cannot satisfy this
Task.
