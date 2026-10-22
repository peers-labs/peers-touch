# XCFG-U03-CLEANUP - Obsolete Resource Removal

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "XCFG-UNIFIED-20261019",
  "taskId": "XCFG-U03-CLEANUP",
  "workstreamId": "XCFG-CLEANUP",
  "title": "Delete obsolete X Config cloud resources and prove zero active residue",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "x-config-unified-cleanup",
  "journeyId": "XCFG-OBSOLETE-RESOURCE-REMOVAL",
  "runtimeClass": "service",
  "writeSet": [
    "docs/architecture/platform/client/control-plane",
    "tooling/acceptance",
    "tooling/skills/pt-x-config-2-vercel"
  ],
  "readSet": [
    "apps/x-config",
    "apps/desktop/src-tauri/src/application/x_config",
    "apps/mobile/src-tauri/src/runtime/x_config.rs"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "x-config-active-source-clean",
      "command": "python3 tooling/scripts/acceptance-validate.py --domain x-config && node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "x-config-cloud-inventory-clean",
      "command": "sh -c '! gh repo view $GITHUB_OWNER/peers-x-config-data >/dev/null 2>&1 && ! gh repo view $GITHUB_OWNER/peers-x-config-ledger >/dev/null 2>&1 && vercel project ls --json | python3 -c \"import json,sys; names=[p.get(\\\"name\\\") for p in json.load(sys.stdin).get(\\\"projects\\\",[])]; raise SystemExit(0 if names.count(\\\"peers-x-config\\\")==1 and not any(n in names for n in (\\\"peers-x-config-admin\\\",\\\"peers-x-config-distribution\\\")) else 1)\"'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "x-config-cleanup-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate x-config-domain-validation",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Only one X Config Vercel project remains",
    "Obsolete Vercel aliases do not resolve",
    "Obsolete X Config data and ledger GitHub repositories return 404",
    "Active source contains no obsolete project, publisher, ledger, approval or client URL path",
    "Production resources remain untouched"
  ],
  "failureBehavior": [
    "Stop deletion if the unified Preview loses OAuth, storage, publication or public readback",
    "Do not delete the shared OAuth storage repository or OAuth project",
    "Do not expose deleted resource contents or secret values"
  ],
  "updatedAt": "2026-10-19T10:47:00.000Z"
}
```

## Claim Boundary

This Task proves removal of task-owned obsolete resources only. It does not
claim Production readiness.

## Current Snapshot

- Obsolete cloud resources remain reachable before unified Preview proof.
- Cleanup authority is explicit but conditional on the Preview Journey.
- The shared OAuth project, App and storage repository are retained resources.
