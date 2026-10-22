# XCFG-U01-SINGLE-SERVICE - Atomic Source And Environment Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "XCFG-UNIFIED-20261019",
  "taskId": "XCFG-U01-SINGLE-SERVICE",
  "workstreamId": "XCFG-SOURCE",
  "title": "Replace independent publication components with one repository-CAS service",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "x-config-unified-source",
  "journeyId": "XCFG-DIRECT-PUBLICATION",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/x-config",
    "apps/desktop/src-tauri/src/application/x_config",
    "apps/mobile/src-tauri/src/runtime/x_config.rs",
    "packages/locales",
    "packages/prototypes/control/x-config",
    "tooling/acceptance",
    "tooling/skills/pt-x-config-2-vercel",
    "docs/architecture"
  ],
  "readSet": [
    "apps/oauth2-client",
    "packages/github-repository",
    "packages/x-config-core",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "x-config-go-service",
      "command": "go test ./apps/x-config/... -count=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "x-config-console-and-prototype",
      "command": "pnpm --dir apps/x-config/console run check && pnpm --dir apps/x-config/console run test && pnpm --dir apps/x-config/console run build && pnpm --dir packages/prototypes/control/x-config run check && pnpm --dir packages/prototypes/control/x-config run build",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "x-config-unified-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate x-config-snapshot-publication-contract --gate x-config-admin-api-contract --gate x-config-vercel-publication-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "x-config-unified-source-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate x-config-domain-validation --gate x-config-snapshot-publication-contract --gate x-config-admin-api-contract --gate x-config-console-admin-e2e --gate x-config-vercel-publication-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "One service owns draft, CAS sequence, signing, persistence and public read",
    "All repository writes use the x-config prefix",
    "Console and prototype expose immediate publication with no approval waiting",
    "Desktop and Mobile use PEERS_X_CONFIG_URL",
    "Independent publisher, ledger and distribution source paths are deleted",
    "Active architecture, Acceptance and deployment contracts describe the same topology"
  ],
  "failureBehavior": [
    "Do not retain a compatibility publisher or alternate storage path",
    "Do not deploy or delete cloud resources before source checks pass",
    "Do not expose secret values in logs, evidence or tracked application source"
  ],
  "updatedAt": "2026-10-19T10:47:00.000Z"
}
```

## Claim Boundary

This Task proves source consistency only. Live OAuth, GitHub persistence,
Vercel Preview, public HTTPS, and client verification remain unproven.

## Current Snapshot

- The accepted architecture is XCFG-D02.
- The pre-cut source still contains independent publisher, ledger and
  distribution paths.
- The env repository has explicit authorization for `x-config-preview`.
