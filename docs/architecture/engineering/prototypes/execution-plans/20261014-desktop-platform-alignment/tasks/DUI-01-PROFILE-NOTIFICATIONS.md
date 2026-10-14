# DUI-01 - Profile and notification closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-01-PROFILE-NOTIFICATIONS","workstreamId":"DUI-SHELL","title":"Close C1-C9 through canonical profile and notification owners","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-profile-notifications","journeyId":"DUI-C1-C9","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/notification","apps/station/frame/touch","model/domain/actor","packages/locales","packages/prototypes/desktop/shell","docs/client/desktop","docs/architecture/engineering/prototypes/execution-plans/20261014-desktop-platform-alignment"],"readSet":["docs/architecture/domains/notification/notification-architecture.md","docs/client/desktop/runtime-projections.md","docs/client/common/ui-identity"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},"checks":[{"id":"dui-profile-notification-source","command":"pnpm --dir apps/desktop run check","verificationClass":"SOURCE_CHECK"},{"id":"dui-profile-notification-functional","command":"pnpm --dir apps/desktop exec vitest run src/components/settings/accountIdentityPresentation.test.ts src/runtimes/settingsRuntime.test.ts src/store/settings.test.ts src/store/relationships.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-profile-notification-proof","command":"python3 tooling/scripts/acceptance-run.py --gate desktop-check","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["C1-C6 read and mutate one revision-fenced Actor profile projection","Avatar and cover use Native OSS flows and unsupported cover history is absent","C7-C9 use authoritative notification list, decisions, category preferences, push registrations, and unread reconciliation","No shell profile or notification control depends on mock data or localStorage"],"failureBehavior":["Reject stale profile or preference revisions without overwriting newer state","Do not invent provider, locale, identity, notification category, or push registration data","Keep runtime-backed state in the owning runtime/store"],"updatedAt":"2026-10-14T13:50:30.000Z"}
```

## Objective

Finish the user identity and notification journeys without introducing a
second profile or notification authority.

## Current Snapshot

- C8 is partial; C1-C7 and C9 have no alignment delta.
- C1-C9 remain formally open.
