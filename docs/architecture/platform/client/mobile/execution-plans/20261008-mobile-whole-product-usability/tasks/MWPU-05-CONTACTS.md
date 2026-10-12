# MWPU-05-CONTACTS: Contacts And Groups Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-05-CONTACTS",
  "workstreamId": "MWPU-PAGES",
  "title": "Close three-client Contacts, requests, profiles, and group creation",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-contacts-usability",
  "journeyId": "MS-J04",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop/src",
    "apps/desktop/src-tauri/src/messaging",
    "apps/mobile/scripts/run-three-client-product-journey.mjs",
    "apps/mobile/scripts/review-mobile-surfaces.mjs",
    "apps/mobile/src/components/MobileAvatar.tsx",
    "apps/mobile/src/components/MobileAvatar.test.tsx",
    "apps/mobile/src/pages/ContactsPage.tsx",
    "apps/mobile/src/pages/ContactsPage.window.test.tsx",
    "apps/mobile/src/features/social",
    "apps/mobile/src/runtimes/socialProjectionRuntime.ts",
    "apps/mobile/src/runtimes/socialProjectionRuntime.test.ts",
    "apps/mobile/src/styles.css",
    "apps/mobile/src-tauri/src/messaging",
    "apps/station/app/subserver/federation",
    "docs/architecture/platform/client/mobile/social-parity/prototype/README.md",
    "docs/client/common/ui-identity/components.md",
    "docs/client/common/ui-identity/modules/social/README.md",
    "docs/client/common/ui-identity/review-checklist.md",
    "docs/client/common/ui-identity/tokens.md",
    "docs/knowledge/README.md",
    "docs/knowledge/invariants/mobile-user-identity-visual-consistency.md",
    "packages/messaging-core/src/mls/key_packages.rs",
    "packages/messaging-core/src/store/repository.rs",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "apps/mobile/src/runtimes/socialProjectionRuntime.ts",
    "apps/mobile/src/runtimes/messagingRuntime.ts",
    "docs/architecture/domains/social",
    "docs/client/common/ui-identity/modules/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 4200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "contacts-source",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/mobile run check:web && pnpm --dir apps/mobile exec vitest run src/components/MobileAvatar.test.tsx src/pages/ContactsPage.window.test.tsx src/features/social && cargo test --manifest-path packages/messaging-core/Cargo.toml mls::key_packages && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml messaging::store::tests::mls_key_package_repository && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml messaging::adapter::tests::mls_outbound_key_packages_and_startup_state_are_durable",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "contacts-foreground-functional",
      "command": "node apps/mobile/scripts/run-three-client-product-journey.mjs --phase contacts",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "contacts-foreground-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-social-convergence-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "contacts-foreground-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set contacts",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "contacts-foreground-functional",
    "scenarioIds": ["alice-bob-coral-discovery", "friend-request", "group-create", "membership-readback"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Alice, Bob, and Coral discover one another, complete friend requests, open profiles, and create the shared Group through foreground Mobile and Desktop controls",
    "people use circular avatars and groups use rounded-square avatars with stable image-loading and deterministic fallback geometry",
    "group, request, and contact rows share one Mobile row hierarchy, spacing system, and 44px interaction target",
    "no-result, duplicate, pending, unavailable, permission, and destructive actions have distinct human-readable recovery",
    "long names and technical identifiers do not break row or modal layout",
    "foreground screenshots and interaction traces cover every declared Contacts row"
  ],
  "failureBehavior": [
    "do not treat empty and unavailable as the same state",
    "do not expose unsupported request or membership actions",
    "do not advance while any Contacts inventory row is unvisited or visually blocked"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Contacts, requests, profiles, Find People, and Create Group are implemented
  in one route-scoped page.
- Existing proof emphasizes command/readback behavior; it does not certify all
  list, detail, overlay, long-copy, unavailable, or role-denied presentation.
- The Owner-confirmed 2026-10-12 prototype makes avatar geometry, shared row
  anatomy, quiet relationship metadata, and stable loading/fallback behavior
  part of this reopened closure.
