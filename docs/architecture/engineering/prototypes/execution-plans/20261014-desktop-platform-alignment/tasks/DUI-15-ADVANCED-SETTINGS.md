# DUI-15 - Advanced settings closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-15-ADVANCED-SETTINGS","workstreamId":"DUI-SETTINGS","title":"Close AD1-AD11 with measured data, real integrations, operational controls, and no fabricated statistics","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-advanced-settings","journeyId":"DUI-AD1-AD11","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver","packages/locales","packages/prototypes/desktop","docs/client/desktop","docs/architecture/domains/chat/storage-governance"],"readSet":["docs/client/desktop/runtime-projections.md","docs/architecture/domains/chat/storage-governance","docs/client/common/ui-identity"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":4800,"cleanupSeconds":300},"checks":[{"id":"dui-advanced-settings-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml","verificationClass":"SOURCE_CHECK"},{"id":"dui-advanced-settings-functional","command":"pnpm --dir apps/desktop exec vitest run src/components/settings/ChatStorageSettings.test.tsx src/runtimes/chatStorageRuntime.test.ts src/runtimes/settingsRuntime.test.ts src/store/settings.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-advanced-settings-proof","command":"python3 tooling/scripts/acceptance-run.py --gate desktop-check && python3 tooling/scripts/acceptance-run.py --gate chat-storage-batch-clear-aggregate-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Storage and files show measured values and real lifecycle actions","Data export labels only real recovery/export capabilities","Channels, applet settings, logs, cron, command palette, onboarding reset, and About use authoritative APIs","Fabricated statistics, Email/Matrix bridges, fake applets, and fake cron targets are absent"],"failureBehavior":["Never display an invented byte count, heatmap, ranking, log, version, or integration status","Never mix core messaging routes into outbound channel settings","Preserve physical storage proof boundaries"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Turn Advanced Settings into an operational surface over real owners and delete
every fabricated metric or integration.

## Current Snapshot

- AD11 is implemented/unproven; AD7 is partial.
- AD1-AD6 and AD8-AD10 have no alignment delta.
