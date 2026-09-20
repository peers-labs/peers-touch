# LDCP-P4: Peers Dev Application Cutover

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PROGRESS-20260917",
  "taskId": "LDCP-P4",
  "workstreamId": "LDCP-DEV-APP",
  "title": "Peers Dev application cutover",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ldcp-peers-dev-app",
  "journeyId": "LDCP-J04-single-dev-app",
  "runtimeClass": "browser",
  "writeSet": [
    "Makefile",
    "apps/dev",
    "docs/README.md",
    "docs/architecture/development-workflow",
    "docs/architecture/local-dev-control-plane",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tooling/make/local-dev.mk",
    "tooling/scripts/README.md",
    "tooling/scripts/local-dev",
    "tooling/scripts/review",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "readSet": [],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "ldcp-dev-app-source",
      "command": "node --check apps/dev/server/index.mjs && node --check apps/dev/server/status.mjs && node --check apps/dev/server/status-worker.mjs && node --check apps/dev/web/app.js",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ldcp-dev-app-tests",
      "command": "node --test apps/dev/server/*.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ldcp-dev-app-cutover",
      "command": "tree-wide old-path and command scan",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "ldcp-dev-app-visual",
      "command": "browser screenshots at desktop and mobile viewport",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "apps/dev is the only Development Control Plane application implementation",
    "make dev-ui starts the fixed 127.0.0.1:4177 listener or reports the existing Peers Dev instance",
    "concurrent starts produce exactly one listener and every loser exits successfully after verifying server identity",
    "a foreign listener on 127.0.0.1:4177 fails with DEV_SERVER_PORT_CONFLICT",
    "the server projects its source workspace, branch and HEAD without exposing canonical paths",
    "the old env dashboard assets, local-dev server script and env-dashboard commands are deleted"
  ],
  "failureBehavior": [
    "never use PID metadata as the exclusivity authority",
    "never kill or replace an existing server implicitly",
    "never accept an unrelated listener as Peers Dev",
    "never retain compatibility shims or duplicate dashboard implementations"
  ],
  "updatedAt": "2026-09-17T09:47:55.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "pnpm --filter @peers-touch/app-dev check"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "Peers Dev 10/10, Machine Dev 13/13, Plan and declaration 124/124, profile resolution 12/12"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "active-tree legacy dashboard scan returned zero; env dashboard directory absent; skill-check passed"
    },
    {
      "verificationClass": "UX_REVIEW",
      "result": "PASS",
      "ref": "Headless Chrome renders at 1440x900 and 390x844 with live source identity and no overlap"
    }
  ]
}
```

## Objective

Make Peers Dev a first-class `apps/dev` application and use the operating
system's fixed TCP listener as the machine-wide single-instance authority.

## Concurrency Decision

- Mode: serial.
- The app cutover, command rename, old-path deletion and fixed-port runtime
  are one atomic ownership change.
- Parallel writers would overlap shared paths and could leave two server
  implementations or two launch contracts.
- One integrator owns architecture, source migration, runtime shutdown/start,
  old-path scan, visual verification and plan closure.

## Current Snapshot

- LDCP-P1 through LDCP-P3 are complete.
- User accepted `apps/dev` with product name `Peers Dev`.
- `apps/dev` is the only application implementation; legacy tooling and env
  dashboard sources are removed.
- The live server owns `127.0.0.1:4177`; concurrent launch and status requests
  preserve one listener and compatible reuse.
- Source, functional, structural and responsive browser checks pass.
