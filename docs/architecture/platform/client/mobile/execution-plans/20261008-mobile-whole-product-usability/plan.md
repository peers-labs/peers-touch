# Mobile Whole-Product Usability - Plan Package

> **Plan ID**: mobile-whole-product-usability-20261008
> **Created**: 2026-10-08T00:00:00.000Z

## Plan

```json
{
  "kind": "peers-touch-plan",
  "planId": "mobile-whole-product-usability-20261008",
  "createdAt": "2026-10-08T00:00:00.000Z",
  "northStar": {
    "objective": "Make the complete Peers Touch Mobile product understandable, operable, accessible, and visually coherent by repairing every reachable surface and proving each one through a foreground iOS Simulator walkthrough.",
    "successCriteria": [
      {
        "id": "MWPU-NS-01",
        "statement": "Every registered pre-shell, tab, detail, overlay, and required recovery state is opened and operated in a visible iOS Simulator with complete screenshot, DOM/AX, and interaction evidence.",
        "sourceRefs": ["MS-C15", "MS-J08", "MS-PA28", "MS-D28"]
      },
      {
        "id": "MWPU-NS-02",
        "statement": "Every visited surface has human-readable identity, coherent hierarchy, usable controls, local truthful recovery, and zero raw-identifier, untranslated-copy, clipping, overlap, occlusion, or app-obstructing module-failure defects.",
        "sourceRefs": ["MS-C15", "MS-PA29", "MS-AG12", "UI Identity"]
      },
      {
        "id": "MWPU-NS-03",
        "statement": "The final exact-source Mobile build passes focused checks, page-specific product proof, whole-product foreground review, formal Acceptance, and terminal runtime cleanup without relabeling the historical MICU-03 Session evidence.",
        "sourceRefs": ["MS-D26", "MS-D28", "DWF-D42"]
      }
    ]
  },
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/platform/client/mobile/product-definition.md",
      "docs/architecture/platform/client/mobile/experience-contract.md",
      "docs/architecture/platform/client/mobile/product-state-model.md",
      "docs/architecture/platform/client/mobile/product-feasibility.md",
      "docs/architecture/platform/client/mobile/acceptance-matrix.md",
      "docs/architecture/platform/client/mobile/design.md",
      "docs/architecture/platform/client/mobile/decisions.md",
      "docs/architecture/platform/client/mobile/prototype/README.md",
      "docs/client/common/ui-identity",
      "docs/client/common/ux-design-methodology.md",
      "docs/client/mobile",
      "docs/knowledge/invariants/client-ui-identity-before-edit.md",
      "docs/knowledge/invariants/chat-message-boundaries.md",
      "docs/knowledge/invariants/mobile-chat-layout-boundaries.md",
      "docs/knowledge/invariants/composite-form-control-boundaries.md"
    ],
    "decisions": [
      "MS-D03",
      "MS-D04",
      "MS-D14",
      "MS-D26",
      "MS-D27",
      "MS-D28",
      "DWF-D42"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps/mobile/package.json", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile/scripts", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile/src", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile/src-tauri/src", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/domains/chat/lifecycle", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/domains/notification", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/domains/social", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/platform/client/mobile", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/platform/station/access", "mode": "shared-read"},
      {"pathPrefix": "docs/client/chat", "mode": "shared-read"},
      {"pathPrefix": "docs/client/common/ui-identity", "mode": "shared-read"},
      {"pathPrefix": "docs/client/common/ux-design-methodology.md", "mode": "shared-read"},
      {"pathPrefix": "docs/client/mobile", "mode": "shared-read"},
      {"pathPrefix": "docs/knowledge", "mode": "shared-read"},
      {"pathPrefix": "packages/locales", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes/mobile/chat", "mode": "exclusive-write"},
      {"pathPrefix": "reports/mobile-infra-chat-usable", "mode": "shared-read"},
      {"pathPrefix": "reports/mobile-whole-product-usability", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/capabilities/mobile.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/core", "mode": "shared-read"},
      {"pathPrefix": "tooling/acceptance/environments/mobile-direct-simulator.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/environments/mobile-ios-layout-simulator.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/environments/mobile-simulator.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/features/mobile-native-accessibility-performance.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/gates/mobile", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/gates.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/plans/mobile-shell.json", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/provisioners/mobile_simulator.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/registry.yaml", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "Change Station, Conversation, Social, Notification, Profile, or Settings business authority",
      "Enable deferred WeChat OAuth, voice/video calls, or Chat Docs",
      "Claim cross-Station, Relay, Android, or physical-device readiness",
      "Replace foreground product operation with API, Harness-only, DOM-only, or headless-only evidence",
      "Modify or relabel immutable MICU-03 Session-class evidence",
      "Push, create a pull request, merge, release, or rewrite history"
    ]
  },
  "tasks": [
    {"id": "MWPU-01-INVENTORY", "workstreamId": "MWPU-FOUNDATION", "path": "tasks/MWPU-01-INVENTORY.md", "dependsOn": []},
    {"id": "MWPU-02-SHELL", "workstreamId": "MWPU-FOUNDATION", "path": "tasks/MWPU-02-SHELL.md", "dependsOn": ["MWPU-01-INVENTORY"]},
    {"id": "MWPU-03-ENTRY", "workstreamId": "MWPU-PAGES", "path": "tasks/MWPU-03-ENTRY.md", "dependsOn": ["MWPU-02-SHELL"]},
    {"id": "MWPU-03-RECOVERY", "workstreamId": "MWPU-PAGES", "path": "tasks/MWPU-03-RECOVERY.md", "dependsOn": ["MWPU-03-ENTRY"]},
    {"id": "MWPU-04-CHAT", "workstreamId": "MWPU-PAGES", "path": "tasks/MWPU-04-CHAT.md", "dependsOn": ["MWPU-03-RECOVERY"]},
    {"id": "MWPU-05-CONTACTS", "workstreamId": "MWPU-PAGES", "path": "tasks/MWPU-05-CONTACTS.md", "dependsOn": ["MWPU-04-CHAT"]},
    {"id": "MWPU-06-MOMENTS", "workstreamId": "MWPU-PAGES", "path": "tasks/MWPU-06-MOMENTS.md", "dependsOn": ["MWPU-05-CONTACTS"]},
    {"id": "MWPU-07-SETTINGS", "workstreamId": "MWPU-PAGES", "path": "tasks/MWPU-07-SETTINGS.md", "dependsOn": ["MWPU-06-MOMENTS"]},
    {"id": "MWPU-07-FRONTIER", "workstreamId": "MWPU-PROOF", "path": "tasks/MWPU-07-FRONTIER.md", "dependsOn": ["MWPU-07-SETTINGS"]},
    {"id": "MWPU-08-PROOF", "workstreamId": "MWPU-PROOF", "path": "tasks/MWPU-08-PROOF.md", "dependsOn": ["MWPU-07-FRONTIER"]}
  ],
  "authorization": {
    "checkpoint": {"localCommit": "allowed"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {
      "deployProfiles": [
        "chat-native-disposable",
        "chat-native-disposable-station",
        "mobile-simulator",
        "mobile-ios-layout-simulator",
        "mobile-station-lifecycle-simulator",
        "mobile-direct-simulator",
        "mobile-social-simulator"
      ],
      "destructiveResetScopes": ["mobile-social-simulator-actors"]
    },
    "history": {"rewrite": "denied"}
  },
  "amendments": [],
  "northStarApproval": {
    "northStarDigest": "79940f36d00954534d674fc0b03841e6f1b6eb175baec7c2fdf902c94e86c060",
    "approvedBy": "acceptance@test.invalid",
    "approvedAt": "2026-10-07T16:58:46.427Z",
    "decisionRef": "trae-chat:6ac3c21a832b0391483a590a:20261008:whole-product-page-by-page"
  },
  "criterionCoverage": [
    {
      "criterionId": "MWPU-NS-01",
      "taskIds": ["MWPU-01-INVENTORY", "MWPU-02-SHELL", "MWPU-03-ENTRY", "MWPU-03-RECOVERY", "MWPU-04-CHAT", "MWPU-05-CONTACTS", "MWPU-06-MOMENTS", "MWPU-07-SETTINGS", "MWPU-07-FRONTIER", "MWPU-08-PROOF"],
      "closureIds": ["mobile-surface-inventory", "mobile-shell-foundation", "mobile-entry-usability", "mobile-recovery-usability", "mobile-chat-usability", "mobile-contacts-usability", "mobile-moments-usability", "mobile-settings-usability", "mobile-final-functional-frontier", "mobile-whole-product-proof"],
      "gateIds": ["mobile-simulator-access-e2e", "mobile-simulator-runtime-lifecycle-e2e", "mobile-simulator-station-lifecycle-e2e", "mobile-simulator-recovery-e2e", "mobile-simulator-recovery-ui-e2e", "mobile-simulator-chat-contacts-e2e", "mobile-simulator-social-convergence-e2e", "mobile-simulator-moments-e2e", "mobile-simulator-settings-e2e", "mobile-ios-simulator-layout-accessibility-e2e", "mobile-simulator-platform-e2e", "mobile-domain-validation"]
    },
    {
      "criterionId": "MWPU-NS-02",
      "taskIds": ["MWPU-02-SHELL", "MWPU-03-ENTRY", "MWPU-03-RECOVERY", "MWPU-04-CHAT", "MWPU-05-CONTACTS", "MWPU-06-MOMENTS", "MWPU-07-SETTINGS", "MWPU-07-FRONTIER", "MWPU-08-PROOF"],
      "closureIds": ["mobile-shell-foundation", "mobile-entry-usability", "mobile-recovery-usability", "mobile-chat-usability", "mobile-contacts-usability", "mobile-moments-usability", "mobile-settings-usability", "mobile-final-functional-frontier", "mobile-whole-product-proof"],
      "gateIds": ["mobile-simulator-access-e2e", "mobile-simulator-runtime-lifecycle-e2e", "mobile-simulator-station-lifecycle-e2e", "mobile-simulator-recovery-e2e", "mobile-simulator-recovery-ui-e2e", "mobile-simulator-chat-contacts-e2e", "mobile-simulator-social-convergence-e2e", "mobile-simulator-moments-e2e", "mobile-simulator-settings-e2e", "mobile-ios-simulator-layout-accessibility-e2e", "mobile-simulator-platform-e2e", "mobile-domain-validation"]
    },
    {
      "criterionId": "MWPU-NS-03",
      "taskIds": ["MWPU-07-FRONTIER", "MWPU-08-PROOF"],
      "closureIds": ["mobile-final-functional-frontier", "mobile-whole-product-proof"],
      "gateIds": ["mobile-ios-simulator-layout-accessibility-e2e", "mobile-simulator-platform-e2e", "mobile-domain-validation"]
    }
  ]
}
```

## Acceptance Execution

```json
{
  "closures": {
    "mobile-surface-inventory": [],
    "mobile-shell-foundation": [],
    "mobile-entry-usability": ["mobile-simulator-access-e2e"],
    "mobile-recovery-usability": ["mobile-simulator-runtime-lifecycle-e2e", "mobile-simulator-station-lifecycle-e2e", "mobile-simulator-recovery-e2e", "mobile-simulator-recovery-ui-e2e"],
    "mobile-chat-usability": ["mobile-simulator-chat-contacts-e2e"],
    "mobile-contacts-usability": ["mobile-simulator-social-convergence-e2e"],
    "mobile-moments-usability": ["mobile-simulator-moments-e2e"],
    "mobile-settings-usability": ["mobile-simulator-settings-e2e"],
    "mobile-final-functional-frontier": [],
    "mobile-whole-product-proof": ["mobile-ios-simulator-layout-accessibility-e2e", "mobile-simulator-platform-e2e", "mobile-domain-validation"]
  },
  "completion": [
    "mobile-contract-static",
    "mobile-native-build",
    "mobile-simulator-access-e2e",
    "mobile-simulator-runtime-lifecycle-e2e",
    "mobile-simulator-station-lifecycle-e2e",
    "mobile-simulator-recovery-e2e",
    "mobile-simulator-recovery-ui-e2e",
    "mobile-simulator-chat-contacts-e2e",
    "mobile-simulator-social-convergence-e2e",
    "mobile-simulator-moments-e2e",
    "mobile-simulator-settings-e2e",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-simulator-platform-e2e",
    "mobile-domain-validation"
  ],
  "full": [
    "mobile-contract-static",
    "mobile-native-build",
    "mobile-simulator-access-e2e",
    "mobile-simulator-runtime-lifecycle-e2e",
    "mobile-simulator-station-lifecycle-e2e",
    "mobile-simulator-recovery-e2e",
    "mobile-simulator-recovery-ui-e2e",
    "mobile-simulator-social-convergence-e2e",
    "mobile-simulator-chat-contacts-e2e",
    "mobile-simulator-moments-e2e",
    "mobile-simulator-settings-e2e",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-simulator-platform-e2e",
    "mobile-domain-validation",
    "acceptance-plan-self",
    "acceptance-infra-validation"
  ]
}
```

## Goal

Replace the invalid whole-product completion implication with a source-backed
Mobile usability closure. Preserve the completed MICU-03 Session proof as a
narrow historical result, then inspect and repair the real production
application surface by surface until every required route and state passes a
foreground iOS walkthrough.

## Execution Rule

- Work is strictly page-by-page after the shared Shell foundation.
- A page Task cannot close from source tests alone.
- Every page Task requires visible foreground interaction and reviewed
  screenshots for its declared surfaces and states.
- The final Task reruns the complete inventory from launch to every tab,
  detail, overlay, recovery state, Station change, and logout.
- Any omitted surface, raw technical label, app-obstructing module failure,
  clipped/overlapping content, inaccessible action, or unexplained dead end
  keeps the Plan incomplete.
