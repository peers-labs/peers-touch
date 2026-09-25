# W6C-PRIVACY - Owner-Backed Privacy Settings

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6C-PRIVACY",
  "workstreamId": "W6C",
  "title": "Owner-backed Mobile privacy settings",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W6C-privacy-source",
  "journeyId": "MS-J06-privacy",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/pages/SettingsPage.tsx",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/services/gateways/profileGateway.test.ts",
    "apps/mobile/src/services/gateways/profileGateway.ts",
    "packages/locales/en/common.json",
    "packages/locales/zh-CN/common.json",
    "packages/prototypes/mobile/chat/src/components/SettingDetailView.tsx",
    "packages/prototypes/mobile/chat/src/mobilePrototype.css",
    "packages/prototypes/mobile/chat/src/pages/ProfilePage.tsx"
  ],
  "readSet": [
    "apps/station/frame/touch/actor/profile.go",
    "docs/architecture/mobile",
    "model/domain/actor/actor.proto"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "settings-privacy-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/services/gateways/profileGateway.test.ts src/pages/settings/SettingsPage.test.ts src/pages/settings/SettingsSections.test.tsx src/pages/settings/useSettingsController.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "settings-privacy-prototype-sync",
      "command": "pnpm --dir packages/prototypes/mobile/chat build --configLoader runner",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Mobile reads and writes all four existing Station-owned privacy fields",
    "Save readback and conflict handling preserve the canonical Station values",
    "The privacy surface no longer reports an implemented owner contract as unavailable",
    "The Mobile prototype shows the same four owner-backed privacy controls"
  ],
  "failureBehavior": [
    "Do not create a second privacy store or endpoint",
    "Blocked-user operations remain unavailable until W5-OWNER lands",
    "Native conflict proof remains in W6C-PROOF"
  ],
  "updatedAt": "2026-09-16T14:32:52Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/services/gateways/profileGateway.test.ts"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/pages/settings/useSettingsController.test.ts"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/mobile/src/pages/settings/SettingsSections.test.tsx"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "packages/prototypes/mobile/chat/src/components/SettingDetailView.tsx"
    }
  ]
}
```

## Objective

Expose the four privacy fields already owned and persisted by the Actor Profile
contract through the existing Mobile profile gateway and Settings controller.

## Current Snapshot

- Mobile now reads and writes all four Station-owned privacy fields through the
  existing Actor Profile endpoint and authoritative GET readback.
- Settings drafts preserve local edits across repeated readback, report a
  divergent Station value as conflict, and accept canonical confirming readback.
- Privacy is a selected-only Settings detail with no new store, endpoint, page
  lifetime, or runtime owner.

## Concurrency Decision

- Execution is serial. Gateway transport, profile draft shape, Settings controls,
  locale keys, and prototype detail all consume the same four-field contract.
- The integrator owns every write path, both verification commands, Task
  evidence, manifest advancement, and the final reconcile.
- `W6B-WIRE` and `W7-SOURCE-SYNC` stay ready but cannot become concurrent
  current Tasks while `W6C-PRIVACY` is in progress.

## Verification Snapshot

- Focused Settings and gateway suite: 33/33 PASS.
- `pnpm --dir apps/mobile run check`: PASS, including TypeScript, Vite build,
  offline Rust check, and Xcode project inspection.
- Mobile prototype build: PASS with the pre-existing large-chunk warning.
- Live prototype DOM/geometry: Privacy opens through a semantic button, exposes
  all four controls, and reports 378px scroll/client width and 785px
  scroll/client height with no overflow. Screenshot capture timed out and is
  not claimed.

## Frontend Tree Review

- Surface: Mobile Me / Privacy selected Settings detail.
- Alive category: unchanged (`on-visit + none` with `lazy section` details).
- Runtime/store owner: session-scoped Social profile projection and existing
  Settings draft controller.
- Verdict: follows the existing registry row; no lifetime or registry change is
  required.

## Prototype Sync

- Drift type: prototype bug and incomplete owner-backed Privacy detail.
- Action: replace the generic detail with the same four controls and make
  Settings rows semantic buttons.
- Residual drift: native interaction, restart, and second-device conflict proof
  remain in `W6C-PROOF`.
