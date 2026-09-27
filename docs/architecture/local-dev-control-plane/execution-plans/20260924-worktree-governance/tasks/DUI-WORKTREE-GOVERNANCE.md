# Dev UI Worktree Governance

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DEV-UI-WORKTREE-GOVERNANCE-20260924",
  "taskId": "DUI-WORKTREE-GOVERNANCE",
  "workstreamId": "DUI-GOVERNANCE",
  "title": "Deliver inspectable and guarded worktree governance",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dev-ui-worktree-governance",
  "journeyId": "DUI-J02",
  "runtimeClass": "browser",
  "writeSet": [
    "apps/dev",
    "docs/architecture/developer-toolchain",
    "docs/architecture/local-dev-control-plane",
    "docs/knowledge/invariants/worktree-observation-is-diagnostic.md",
    "tooling/acceptance",
    "tooling/devctl",
    "tooling/make/local-dev.mk",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "readSet": [
    "docs/architecture/development-workflow",
    "docs/client/common/ui-identity",
    "tooling/scripts/plan"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "worktree-governance-node",
      "command": "node --test tooling/devctl/test/worktree.test.mjs apps/dev/server/worktree-governance.test.mjs apps/dev/server/worktree-discovery.test.mjs apps/dev/server/status.test.mjs apps/dev/server/index.test.mjs apps/dev/server/dev-ui-journey.test.mjs tooling/scripts/local-dev/workflow-conversation-binding.test.mjs tooling/scripts/local-dev/machine-dev.test.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "dev-ui-source-check",
      "command": "pnpm --filter @peers-touch/app-dev check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "dev-ui-browser-journey",
      "command": "python3 tooling/scripts/acceptance-run.py --gate dev-ui-browser-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "dev-ui-contract-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "runtime-provisioning-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-runtime-provisioning-self",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "development-control-plane-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Users can search, filter, sort and select worktrees without changing workflow identity",
    "Creation, disk and master-distance metrics expose provenance and typed unavailable states",
    "The details surface shows requirements, environment, resources, leases and all safety blockers",
    "Main, serving, conversation-bound, active, dirty, detached, locked and unmerged targets cannot receive a removal ticket",
    "Tickets are same-origin, short-lived, one-shot and invalidated by state changes",
    "Successful removal is non-force, preserves the branch and Acceptance Evidence, and retires idle workspace machine state",
    "Desktop and narrow browser Journeys pass against exact source"
  ],
  "failureBehavior": [
    "Do not expose canonical roots or secret-bearing profile fields",
    "Do not let browser selection alter conversation, Plan, declaration, registration or lease state",
    "Do not infer activity from observation freshness, commit time or filesystem metadata",
    "Do not remove a worktree when any required fact is unavailable",
    "Do not delete branches, use force removal or hide partial cleanup"
  ],
  "updatedAt": "2026-09-23T19:36:05.872Z",
  "durableEvidence": [
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "machine-dev://workspaces/5f50d8bb381b0123/workflow/DEV-UI-WORKTREE-GOVERNANCE/checks/functional-result-2c914ba0074890cba10933de2657622a23048c0c6204d2979e1247537f76dd94.json"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://5f50d8bb381b0123/acceptance-run/20260923T192849275888Z-7316536f890811edcd2141f10f607ff3/reports/run.json"
    }
  ]
}
```

## Current Snapshot

- Session reached `DELIVERY_READY` on exact clean source `4cd0b1018`.
- Dev UI exposes 25 discovered worktrees with browser-local selection, search,
  filter, sorting, lifecycle provenance, disk usage and local-master distance.
- The detail view projects workflow owners, requirements, resources, leases
  and every removal blocker without changing conversation identity.
- Retirement remains owned by `tooling/devctl/worktree.mjs`: no force, no
  branch deletion, one-shot confirmation and execution-time revalidation.
- Main, serving, bound, active, dirty, detached, locked and unmerged worktrees
  fail closed.
- Desktop and narrow-browser functional evidence passed against the exact
  source; formal completion Acceptance is `DONE/PROVEN` for all four Gates.
- No real worktree was removed during verification.
- The fixed Dev UI remains available at `http://127.0.0.1:4177`.

## Concurrency Decision

- Mode: serial integration.
- Reason: query schema, HTTP ticket lifecycle, `devctl` retirement, UI and
  Acceptance share one safety contract and one final source identity.
