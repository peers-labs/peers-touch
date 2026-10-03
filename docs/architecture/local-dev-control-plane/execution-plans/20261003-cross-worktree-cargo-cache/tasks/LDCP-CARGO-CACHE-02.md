# Prove Cargo Cache Integration

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "LDCP-CARGO-CACHE-20261003",
  "taskId": "LDCP-CARGO-CACHE-02",
  "workstreamId": "LDCP-CARGO-CACHE",
  "title": "Prove Cargo cache integration",
  "workClass": "infrastructure",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "cargo-cache-acceptance",
  "journeyId": "LDCP-J-CARGO-CACHE",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/local-dev-control-plane/execution-plans/20261003-cross-worktree-cargo-cache"
  ],
  "readSet": [
    ".cargo",
    "Makefile",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/local-dev-control-plane",
    "tooling/make/setup.mk",
    "tooling/scripts/architecture/module-governance.test.mjs",
    "tooling/scripts/cargo-cache.sh",
    "tooling/scripts/cargo-cache.test.mjs",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "cargo-cache-acceptance-source",
      "command": "git diff --check && git status --short",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "cargo-cache-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation --gate acceptance-plan-self --gate acceptance-runtime-provisioning-self --gate acceptance-workflow-contract --gate architecture-module-governance --gate dev-ui-browser-e2e --gate machine-dev-registry-self --gate peers-dev-product",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All impacted Local Dev and Development Workflow Gates pass from one clean source identity",
    "The browser Gate uses the same committed source as the Plan",
    "Acceptance cleanup completes without leaving a managed runtime"
  ],
  "failureBehavior": [
    "Do not accept stale or mixed-source evidence",
    "Do not replace the source-only functional result with browser runtime identity",
    "Do not leave Peers Dev running after proof",
    "Do not merge or rewrite history"
  ],
  "updatedAt": "2026-10-03T15:25:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- The implementation checkpoint is `d0f19deec`.
- The full eight-Gate development run passed on that checkpoint.
- This Task separates formal Acceptance aggregation from the source-only
  functional result contract.
