# DUI-14 - Applet governance closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-14-APPLET-GOVERNANCE","workstreamId":"DUI-APPLETS","title":"Close AP9-AP12 through uninstall, capability governance, integrity, and truthful notification state","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-applet-governance","journeyId":"DUI-AP9-AP12","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/applet_store","packages/applet-contract","packages/applet-kernel","packages/prototypes/desktop","packages/locales","docs/architecture/platform/applet-runtime"],"readSet":["docs/architecture/platform/applet-runtime","docs/client/desktop/applet-runtime-lifecycle.md"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":4200,"cleanupSeconds":240},"checks":[{"id":"dui-applet-governance-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml","verificationClass":"SOURCE_CHECK"},{"id":"dui-applet-governance-functional","command":"pnpm --dir apps/desktop exec vitest run src/store/applets.test.ts src/runtimes/appletsRuntime.test.ts src/runtimes/agentCapabilityRuntime.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-applet-governance-proof","command":"python3 tooling/scripts/acceptance-run.py --gate applet-desktop-lifecycle-smoothness && python3 tooling/scripts/acceptance-run.py --gate applet-domain-validation","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Non-bundled applets uninstall with deterministic session cleanup","Permissions, approval policy, audit, quotas, and payload limits are inspectable","Revoked, disabled, update-available, offline, and integrity failures are visible","Launcher badges are either backed by an accepted projection or absent"],"failureBehavior":["Never allow a revoked applet to launch","Never uninstall bundled official applets","Never synthesize notification badges from local decoration"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Finish the applet trust lifecycle after launcher and runtime identity are
canonical.

## Current Snapshot

- AP9 and AP11 are implemented/unproven.
- AP10 and AP12 have no alignment delta.
