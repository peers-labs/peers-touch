# DUI-12 - Applet catalog and identity closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-12-APPLET-CATALOG","workstreamId":"DUI-APPLETS","title":"Close AP1-AP3 and AP13-AP14 through one real launcher/catalog identity","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-applet-catalog","journeyId":"DUI-AP1-AP3-AP13-AP14","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/applet_store","packages/applet-contract","packages/applets","packages/prototypes/desktop","packages/locales","docs/architecture/platform/applet-runtime"],"readSet":["docs/architecture/platform/applet-runtime","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":3600,"cleanupSeconds":240},"checks":[{"id":"dui-applet-catalog-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml","verificationClass":"SOURCE_CHECK"},{"id":"dui-applet-catalog-functional","command":"pnpm --dir apps/desktop exec vitest run src/applet/AppletManager.test.ts src/store/applets.test.ts src/runtimes/appletsRuntime.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-applet-catalog-proof","command":"python3 tooling/scripts/acceptance-run.py --gate applet-domain-validation && python3 tooling/scripts/acceptance-run.py --gate applet-desktop-lifecycle-smoothness","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Launcher and search merge installed and Station catalog projections","Local import uses the supported directory flow and Store install is live","Only real applet identities are shown","Dead legacy registry ownership and fictional applet cards are removed"],"failureBehavior":["Never install a revoked or incompatible applet","Never advertise `.bundle` import when no such contract exists","Do not retain the legacy registry as a fallback"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Establish one truthful applet inventory before runtime and governance work
builds on it.

## Current Snapshot

- AP1-AP3 and AP13 are implemented/unproven.
- AP14 remains open.
