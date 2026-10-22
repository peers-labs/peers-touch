# R001-01-BASELINE: Freeze The 0.0.1 Candidate And Release Inventory

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "release-0.0.1-mobile-ios-desktop-acceptance-20261017",
  "taskId": "R001-01-BASELINE",
  "workstreamId": "R001-RELEASE",
  "title": "Freeze one exact-source non-AI release candidate and prove both native builds",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "release-baseline",
  "journeyId": "R001-J00",
  "runtimeClass": "service",
  "writeSet": [
    "docs/architecture/engineering/acceptance/execution-plans/20261017-release-0.0.1-mobile-ios-desktop",
    "tooling/skills/pt-github-review/FRESHNESS.md",
    "docs/architecture/engineering/api-governance/station-api-capabilities.yaml",
    "pnpm-lock.yaml",
    "tooling/acceptance",
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "model/domain",
    "packages/messaging-core",
    "packages/secure-content-core",
    "packages/client-chat-core",
    "packages/locales",
    "docs/knowledge"
  ],
  "readSet": [
    "docs/architecture/platform/client/mobile",
    "docs/architecture/platform/station/access",
    "docs/architecture/platform/runtime/node-connectivity",
    "docs/architecture/domains/federation",
    "docs/architecture/domains/chat/lifecycle",
    "docs/architecture/domains/social",
    "docs/client"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 1,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "release-plan-structure",
      "command": "make plan-validate PLAN=docs/architecture/engineering/acceptance/execution-plans/20261017-release-0.0.1-mobile-ios-desktop/plan.md && make acceptance-validate && node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "release-source-contracts",
      "command": "./model/build.sh && go run ./apps/station/app/cmd/station_api_ownership --root . --registry docs/architecture/engineering/api-governance/station-api-capabilities.yaml && python3 -c 'from tooling.acceptance.gates.station_access.capability_contract import validate_station_access_capability_contract as validate; validate()' && python3 -c 'from tooling.acceptance.gates.mobile.contract_static import MobileContractStaticGate; MobileContractStaticGate().run(); MobileContractStaticGate(hard_cut=True).run()' && python3 -c 'from tooling.acceptance.gates.mobile.identity_contract import validate_identity_contract as validate; validate()'",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "release-native-builds",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/desktop exec tauri build --ci --no-bundle && pnpm --dir apps/mobile run check && python3 -m tooling.acceptance.gates.mobile.native_build",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "release-baseline-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate proto-build --gate station-api-ownership --gate station-access-capability-contract --gate desktop-check --gate desktop-release-build --gate mobile-contract-static --gate mobile-identity-contract --gate mobile-hard-cut-static --gate mobile-native-build",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Dev Workflow binds one clean release-candidate worktree and current commit without storing mutable HEAD in the Plan",
    "the complete visible non-AI Desktop and iOS surface inventory is recorded; any visible feature omitted from later Tasks blocks this Task",
    "Desktop release and iOS native artifacts build from the same source identity",
    "shared proto, Station route ownership, Station Access, Mobile identity and hard-cut contracts pass",
    "existing required Gates are reused and only missing Federation lifecycle, mixed cross-Station Moments, release UX analysis and release aggregate evidence are added",
    "known default-branch failures are reproduced and either fixed at their owner or explicitly shown not to exist on the candidate",
    "one local checkpoint commit contains only source fixes and acceptance wiring required by this closure"
  ],
  "failureBehavior": [
    "a dirty source, mismatched generated code, missing visible-feature inventory, failed native build or invalid ownership blocks all runtime Tasks",
    "AI surfaces are excluded from execution and report scoring rather than marked passed",
    "a static or build result never proves a user Journey",
    "release blockers are fixed with regression coverage; non-blocking UX preferences are recorded for R001-07 and do not change source"
  ],
  "updatedAt": "2026-10-16T17:47:52.000Z"
}
```

## Current Snapshot

Stable obligation: bind and build one complete non-AI 0.0.1 candidate before
any environment-backed product claim.

## Closure

This Task establishes one buildable candidate and complete non-AI release
inventory. It makes no Relay, Federation, user-journey, or release-readiness
claim.
