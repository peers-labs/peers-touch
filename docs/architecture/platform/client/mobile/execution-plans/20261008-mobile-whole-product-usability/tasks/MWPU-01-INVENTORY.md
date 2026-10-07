# MWPU-01-INVENTORY: Complete Mobile Surface Contract

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-01-INVENTORY",
  "workstreamId": "MWPU-FOUNDATION",
  "title": "Build the executable page and state inventory",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "mobile-surface-inventory",
  "journeyId": "MS-J08",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/acceptance",
    "apps/mobile/scripts/review-mobile-surfaces.mjs",
    "tooling/acceptance/capabilities/mobile.yaml",
    "tooling/acceptance/environments/mobile-ios-layout-simulator.yaml",
    "tooling/acceptance/features/mobile-native-accessibility-performance.yaml",
    "tooling/acceptance/gates/mobile/simulator_layout_accessibility_e2e.py",
    "tooling/acceptance/gates/mobile/simulator_layout_accessibility_e2e_test.py",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/plans/mobile-shell.json",
    "tooling/acceptance/registry.yaml"
  ],
  "readSet": [
    "apps/mobile/src",
    "docs/architecture/platform/client/mobile",
    "docs/client/common/ui-identity",
    "docs/client/mobile",
    "packages/prototypes/mobile/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "surface-inventory-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/app/navigation/navigationDescriptors.test.ts src/acceptance/registry.test.ts && python3 -m unittest tooling.acceptance.gates.mobile.simulator_layout_accessibility_e2e_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "surface-inventory-structure",
      "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "one machine-readable inventory covers every pre-shell state, primary tab, detail route, overlay, and product-owned recovery state",
    "each inventory row names user action, expected visible result, viewport/text-size cells, and screenshot plus DOM/AX evidence",
    "the layout Gate fails closed on a missing or unvisited inventory row",
    "the foreground review runner can execute one named surface set or the complete inventory without weakening its assertions",
    "tooling/acceptance/plans/mobile-shell.json is bound to this Plan and maps MS-PA01..MS-PA29, including the new whole-product assertions",
    "the prior MICU-03 screenshot is registered as a failing usability baseline, not a passing whole-product artifact"
  ],
  "failureBehavior": [
    "do not infer coverage from route source alone",
    "do not accept headless-only screenshots as foreground walkthrough evidence",
    "do not change product business authority or relabel historical evidence"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- The route registry covers four primary tabs, five detail route classes, and
  two overlay route classes, but no single Gate proves all of them.
- The current layout Gate proves launch surfaces only and explicitly excludes
  authenticated Shell surfaces.
- MICU-03 foreground evidence demonstrates that narrow business success can
  coexist with product-blocking visual defects.
