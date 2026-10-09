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
    "apps/mobile/scripts/review-mobile-surfaces.mjs",
    "apps/mobile/scripts/run-three-client-product-journey.mjs",
    "apps/mobile/scripts/three-client-product-journey.matrix.json",
    "apps/mobile/src/pages/moments/MomentComposer.css",
    "apps/mobile/src/pages/moments/Moments.css",
    "docs/architecture/platform/client/mobile/acceptance-matrix.md",
    "docs/architecture/platform/client/mobile/design.md",
    "docs/architecture/platform/client/mobile/decisions.md",
    "tooling/acceptance/capabilities/mobile.yaml",
    "tooling/acceptance/environments/mobile-ios-layout-simulator.yaml",
    "tooling/acceptance/features/mobile-native-accessibility-performance.yaml",
    "tooling/acceptance/gates/mobile/simulator_layout_accessibility_e2e.py",
    "tooling/acceptance/gates/mobile/simulator_layout_accessibility_e2e_test.py",
    "tooling/acceptance/gates/mobile/surface_audit.py",
    "tooling/acceptance/gates/mobile/surface_audit_test.py",
    "tooling/acceptance/gates/mobile/simulator_whole_product_usability_e2e.py",
    "tooling/acceptance/gates/mobile/simulator_whole_product_usability_e2e_test.py",
    "tooling/acceptance/gates/mobile/whole_product_surface_inventory.json",
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
      "command": "pnpm --dir apps/mobile exec vitest run src/app/navigation/navigationDescriptors.test.ts src/acceptance/registry.test.ts && node apps/mobile/scripts/review-mobile-surfaces.mjs --self-test && node apps/mobile/scripts/run-three-client-product-journey.mjs --self-test && python3 -m unittest tooling.acceptance.gates.mobile.surface_audit_test tooling.acceptance.gates.mobile.simulator_layout_accessibility_e2e_test tooling.acceptance.gates.mobile.simulator_whole_product_usability_e2e_test",
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
    "the foreground runner validates and dispatches one named surface set or the complete inventory to the dedicated fail-closed whole-product Gate",
    "one machine-readable three-client matrix covers entry, shell, contacts, Direct, Group, voice message, voice/video call, Social, and recovery with explicit actor, receiver-visible outcome, and evidence requirements",
    "the three-client runner fails closed unless Android Alice, Desktop Bob, and iOS Coral are distinct exact-source foreground clients attached through WebDriver-compatible UI sessions",
    "each inventory row resolves an expected result and the required viewport/text-size cells; page Tasks own missing production selectors and journey adapters",
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
