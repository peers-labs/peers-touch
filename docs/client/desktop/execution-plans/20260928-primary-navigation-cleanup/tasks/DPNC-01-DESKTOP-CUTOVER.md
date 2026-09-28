# Desktop Navigation And Settings Cutover

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DPNC-20260928",
  "taskId": "DPNC-01-DESKTOP-CUTOVER",
  "workstreamId": "DPNC-DESKTOP",
  "title": "Remove standalone Notes and move utility surfaces into Settings",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dpnc-desktop-cutover",
  "journeyId": "DPNC-J01",
  "runtimeClass": "browser",
  "writeSet": [
    "apps/desktop/e2e",
    "apps/desktop/src-tauri/src/application/applets",
    "apps/desktop/src/components",
    "apps/desktop/src/hooks",
    "apps/desktop/src/modules",
    "apps/desktop/src/pages",
    "apps/desktop/src/store/notebook.ts",
    "apps/desktop/src/types/navigation.ts",
    "apps/desktop/src/views",
    "docs/client/common/ui-identity/frontend-component-tree-registry.md",
    "docs/client/desktop",
    "docs/global/coding-guide/desktop/module-registry.md",
    "docs/global/coding-guide/desktop/page-component.md",
    "packages/applet-contract",
    "packages/locales",
    "packages/prototypes/desktop/shell",
    "tooling/acceptance",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "readSet": [
    "apps/applets/note",
    "docs/architecture/applet-runtime",
    "docs/architecture/frontend-runtime",
    "docs/client/common/ui-identity/frontend-component-tree.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "desktop-navigation-source",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/desktop test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-navigation-build",
      "command": "pnpm --dir apps/desktop build",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-navigation-runtime-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.desktop.primary_navigation_e2e_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-navigation-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-plan-self --gate acceptance-infra-validation --gate acceptance-workflow-contract --gate acceptance-runtime-provisioning-self --gate applet-desktop-lifecycle-smoothness --gate desktop-primary-navigation-e2e --gate desktop-check --gate desktop-release-build --gate applet-domain-validation",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Primary navigation no longer exposes Notes, My Files, Cron Jobs, Channels, or a second Command Palette trigger",
    "Settings exposes functional My Files, Cron Jobs, Channels, and Command Palette sections",
    "The standalone Notes page, route, store, commands, and locale namespace have no live references",
    "The canonical global CommandMenu and its keyboard shortcut still work",
    "The official peers.note applet remains unchanged and launchable",
    "An exact-source Desktop journey proves the rail, old-route fallback, and all four Settings sections",
    "My Files, Cron Jobs, and Channels unmount when hidden so their fetch and polling effects stop"
  ],
  "failureBehavior": [
    "Do not redirect removed standalone Notes links to the official Note applet",
    "Do not retain duplicate standalone pages or compatibility routes for migrated utilities",
    "Do not claim completion from static source checks without an interactive Desktop journey",
    "Do not modify files under apps/applets/note"
  ],
  "updatedAt": "2026-09-28T12:04:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "Desktop check; full Desktop Vitest (131 files, 937 passed, 1 skipped); Desktop web production build; applet-contract check/test; prototype build; navigation ownership focused tests"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "Exact-source DPNC-J01 proves the cleaned primary rail, old Notes route fallback, functional Settings controls, selected-only Cron lifecycle, canonical Command Palette, and peers.note launch"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "Formal completion bundle passes all nine declared Gates with DONE/PROVEN aggregate evidence"
    }
  ]
}
```

## Current Snapshot

- State: implementation, exact-source functional verification, and formal
  Acceptance are complete.
- Product contract: `docs/client/desktop/navigation-and-settings-ownership.md`.
- Standalone Desktop Notes ownership is deleted while `apps/applets/note`
  remains unchanged.
- My Files, Cron Jobs, Channels, and Command Palette are Settings-owned and no
  longer have primary-rail ownership.
- Desktop source, test, web build, applet-contract, prototype, and focused
  navigation ownership checks pass.
- DPNC-J01 exercises the Settings-owned controls, verifies hidden Cron polling
  stops, opens the canonical Command Palette from both entry paths, and
  launches the official `peers.note` applet.
- The formal completion bundle passes all nine declared Gates with exact-source
  `DONE/PROVEN` evidence.

## Closure

Desktop has one compact primary rail, Settings exclusively owns the four
utility surfaces, standalone Notes is gone, and the Note applet is unchanged.

## Required Deliverables

- `tooling/acceptance/gates/desktop/primary_navigation_e2e.py`
- Unit coverage for route, module registration, Settings grouping, and
  selected-only lifecycle contracts
- Acceptance registration for `desktop-primary-navigation-e2e`
- Exact-source DOM and screenshot evidence for DPNC-J01
- Desktop shell prototype synchronized to the accepted navigation ownership

## Concurrency Decision

- Mode: serial.
- Reason: navigation, module registration, Settings grouping, routes, locales,
  and exact-source UI proof form one atomic ownership cutover.
