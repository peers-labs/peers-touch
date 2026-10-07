# MPS-12-AGGREGATE - Full Parity Aggregate

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-12-AGGREGATE",
  "workstreamId": "MPS-DELIVERY",
  "title": "Aggregate exact-source RC01-RC10 and PA01-PA19 evidence and enforce the full claim boundary",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "mps-aggregate",
  "journeyId": "MSP-J01-J10-AGGREGATE",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/domains/social/core/README.md",
    "docs/architecture/domains/social/core/acceptance-matrix.md",
    "docs/architecture/domains/social/core/experience-contract.md",
    "docs/architecture/domains/social/core/product-definition.md",
    "docs/architecture/domains/social/core/product-state-model.md",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "docs/architecture/platform/client/mobile/README.md",
    "docs/architecture/platform/client/mobile/social-parity/README.md",
    "docs/architecture/platform/client/mobile/social-parity/acceptance-matrix.md",
    "docs/architecture/platform/client/mobile/social-parity/integration.md",
    "docs/architecture/platform/client/mobile/social-parity/module-layout.md",
    "docs/README.md",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "docs/architecture/shared/federation",
    "docs/architecture/shared/security/secure-content",
    "model/domain/social",
    "packages/locales"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 14400,
    "cleanupSeconds": 1200
  },
  "checks": [
    {
      "id": "mps-aggregate-source",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate --repo-root . && python3 tooling/scripts/acceptance-run.py --gate architecture-module-governance --gate station-api-ownership --gate proto-build --gate mobile-native-build",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-aggregate-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-desktop-parity-aggregate",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Every Plan completion Gate passes against one exact source digest",
    "All five provisioner-selected mixed-client Gates pass or remain explicitly UNPROVEN without being omitted from the Plan",
    "RC01 through RC10 and PA01 through PA19 each have current receiver-visible and authoritative evidence",
    "iOS, physical Android and Desktop six-direction outcomes are equivalent within accepted platform adaptation",
    "Architecture Gates AG01 through AG10 pass with no fallback, duplicate owner or stale evidence",
    "The aggregate emits SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN only when all required cells pass",
    "All Station, Desktop, Simulator, Android, Appium, account, fixture and lease resources are released"
  ],
  "failureBehavior": [
    "Do not aggregate BLOCKED, UNPROVEN, stale-source, prototype or source-only evidence as PASS",
    "Do not emit the full claim while any Android or cross-Station cell is missing",
    "Do not leave runtime resources, plaintext projections, object URLs or test accounts outside cleanup policy"
  ],
  "updatedAt": "2026-10-07T02:06:30.000Z"
}
```

## Objective

机械汇总全部产品、架构、安全、恢复、质量和互操作证据，并把完整声明与 iOS-only
阶段性结果严格分开。

## Current Snapshot

- The accepted matrix defines RC01-RC10 and PA01-PA19 but has no final exact-source aggregate.
- Android same-Station and interoperation evidence remain separate required child closures in v30.
- The five mixed-client candidate Gates are explicit full-proof obligations in v30.
- OPPO PEEM00 serial `dbf93cb7` is currently authorized for the Android runtime cells.
- Existing same-Station and prototype evidence cannot establish the full parity claim.
