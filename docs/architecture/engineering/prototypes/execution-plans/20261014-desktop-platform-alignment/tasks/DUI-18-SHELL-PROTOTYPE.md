# DUI-18 - Shell prototype truthfulness closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-18-SHELL-PROTOTYPE","workstreamId":"DUI-PROTOTYPES","title":"Align shell, login, Settings, notification, and Network prototypes to shipped behavior","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-shell-prototype","journeyId":"DUI-PROTOTYPE-C-AD-N","runtimeClass":"native-desktop","writeSet":["packages/prototypes/desktop","docs/architecture/engineering/prototypes","apps/desktop","packages/locales"],"readSet":["docs/architecture/engineering/prototypes/execution-plans/20261014-desktop-platform-alignment/scope-ledger.md","docs/client/common/ui-identity","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":3000,"cleanupSeconds":180},"checks":[{"id":"dui-shell-prototype-source","command":"pnpm --dir packages/prototypes/desktop/shell run build","verificationClass":"SOURCE_CHECK"},{"id":"dui-shell-prototype-visual","command":"make run-prototype","verificationClass":"UX_REVIEW"},{"id":"dui-shell-prototype-functional","command":"pnpm --dir packages/prototypes/desktop/features/social-chat run qa:geometry","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-shell-prototype-proof","command":"python3 tooling/scripts/acceptance-run.py --gate desktop-primary-navigation-e2e && python3 tooling/scripts/acceptance-run.py --gate desktop-check","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Every C, AD, and N control matches shipped behavior or an accepted CUT","No fake account, Station, device, notification, storage, statistic, channel, log, cron, applet, version, or health value remains","L1 static and L2 visual evidence cover default, empty, loading, error, narrow, and destructive states","Prototype ledger status and implementation references are current"],"failureBehavior":["Never use a Pending marker for behavior that is already shipped","Never present mock operational data as live","Do not let prototype-only state define production semantics"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Make the Desktop shell prototype an honest product contract after the owning
production closures land.

## Current Snapshot

- Shell Settings still contains fake statistics, channels, applets, devices,
  Federation counts, and local-only preferences.
