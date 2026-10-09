# MWPU-08-PROOF: Three-Client Whole-Product Foreground Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-08-PROOF",
  "workstreamId": "MWPU-PROOF",
  "title": "Prove complete Android Alice, Desktop Bob, and iOS Coral product interoperability",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "mobile-whole-product-proof",
  "journeyId": "MS-J08",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/platform/client/mobile/execution-plans/20261008-mobile-whole-product-usability",
    "reports/mobile-whole-product-usability"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile/package.json",
    "apps/mobile/scripts",
    "apps/mobile/src",
    "apps/mobile/src-tauri/src",
    "apps/station",
    "docs/architecture/platform/client/mobile",
    "docs/client/common/ui-identity",
    "docs/client/desktop",
    "docs/client/mobile",
    "packages/prototypes/mobile/chat",
    "reports/mobile-infra-chat-usable/README.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "three-client-final-source",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/mobile run check && go test ./apps/station/app/subserver/conversation/... ./apps/station/app/subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-whole-product-formal",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-whole-product-usability-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-whole-product-plan",
      "command": "make acceptance PLAN=tooling/acceptance/plans/mobile-shell.json",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-domain-validation",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-domain-validation",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-whole-product-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set all --mode review",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "Android Alice, Desktop Bob, and iOS Coral are built from the exact target worktree and each completes Station selection, login, relaunch, and logout",
    "all required Direct, Group, voice message, voice/video call, Social publish, receive, open, and like directions are operated through foreground product controls",
    "every required outcome has sender and receiver screenshots, DOM/AX or native hierarchy, interaction trace, account identity, client identity, Station identity, and source identity evidence",
    "all page-specific development journeys and required formal Gates pass on final exact source",
    "zero blocker or major usability findings remain",
    "the final report explicitly separates this three-client real UI proof from API, Harness-only, headless, historical MICU-03, and physical-Android evidence",
    "all owned simulators, Appium sessions, processes, ports, storage, fixtures, and leases return to baseline"
  ],
  "failureBehavior": [
    "do not aggregate partial page evidence into a whole-product pass",
    "do not accept headless-only execution or screenshots that were not visually reviewed",
    "do not publish PROVEN while any inventory row is missing, failed, or visually unresolved",
    "do not push or create a pull request"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Page-specific Gates exist, but the current layout Gate excludes authenticated
  Shell surfaces and no aggregate enforces route/state completeness.
- The historical MICU-03 run is valid only for Session-class behavior and is a
  failing baseline for whole-product usability.
