# W6C-SETTINGS-STATE - Settings Availability And Device Behavior

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6C-SETTINGS-STATE",
  "workstreamId": "W6C",
  "title": "Settings availability, persistence, and applied device behavior",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "W6C-settings-state-source",
  "journeyId": "MS-J06-settings-recovery",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/App.tsx",
    "apps/mobile/src/app/mobileI18n.tsx",
    "apps/mobile/src/pages/SettingsPage.tsx",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/runtimes/deviceSettingsRuntime.ts",
    "apps/mobile/src/runtimes/deviceSettingsRuntime.test.ts",
    "apps/mobile/src/runtimes/profileProjectionDescriptor.ts",
    "apps/mobile/src/runtimes/profileProjectionDescriptor.test.ts",
    "apps/mobile/src/styles.css",
    "packages/locales/en/common.json",
    "packages/locales/zh-CN/common.json",
    "tooling/acceptance/features/mobile-profile-settings.yaml",
    "tooling/acceptance/registry.yaml"
  ],
  "readSet": [
    "docs/architecture/mobile",
    "docs/architecture/frontend-runtime",
    "docs/architecture/social-runtime"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "settings-state-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/runtimes/profileProjectionDescriptor.test.ts src/runtimes/deviceSettingsRuntime.test.ts src/pages/settings/SettingsPage.test.ts src/pages/settings/SettingsSections.test.tsx src/pages/settings/useSettingsController.test.ts",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Settings fences stale profile and privacy fields when the authoritative Profile projection is unavailable",
    "Save, discard, stay, and failed persistence preserve the correct draft and canonical values",
    "Language persistence failure is visible and does not report an uncommitted selection",
    "Theme, font size, and compact mode are applied by the device-settings runtime"
  ],
  "failureBehavior": [
    "Do not project an authoritative empty blocked-user list while Social owner contracts are missing",
    "Do not invent account-preference endpoints or media auto-download policy",
    "Owner-blocked block/unblock/list/status controls remain unavailable"
  ],
  "updatedAt": "2026-09-17T04:07:00.000Z"
}
```

## Objective

Complete the architecture-defined local Settings behaviors and truthful Profile
availability while preserving owner-blocked account and Social operations.

## Current Snapshot

- The Profile runtime owns availability, but Settings currently consumes only a
  retained profile object and can leave stale fields editable after failure.
- Several device preferences persist but have no applied shell behavior.
- Language selection updates optimistically without surfacing persistence
  failure.

## Source Closure

- Settings subscribes to the authoritative Profile projection and fences
  retained profile/privacy fields whenever that projection is unavailable.
  Retry routes through the Social runtime owner.
- Language writes complete before the canonical selection changes. Failure
  preserves the current language and exposes the exact retry.
- Device settings apply only committed readback to document-owned theme, font,
  and density attributes; failed writes preserve and continue applying the
  previous canonical preferences.
- Blocked-user operations and media auto-download remain visibly unavailable;
  no Social owner or policy endpoint was fabricated.
- Acceptance ownership now covers the i18n, device runtime, Profile projection,
  and selected Settings detail paths.
- Existing save, discard, stay, conflict, and failed-write state remains
  controller-owned.

## Verification Snapshot

- Focused Settings suite: 31/31 PASS.
- Mobile Web checks and scoped diff validation: PASS.
- Formal Settings Acceptance remains deferred because the Plan Package source
  graph is now exhausted behind its recorded architecture and runtime blockers.

## Concurrency Decision

- This slice is independent of Moments and native lifecycle work.
- Execute serially because Settings draft state, device preference application,
  and shell styling share one user-visible save/recovery boundary.
