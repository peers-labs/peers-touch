# Integrate source-aware Station startup

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "LDCP-STATION-SYNC-20260928",
  "taskId": "LDCP-STATION-SYNC-01",
  "workstreamId": "LDCP-STATION-SYNC",
  "title": "Integrate source-aware Station startup",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ldcp-station-source-aware-sync",
  "journeyId": "LDCP-J-STATION-START",
  "runtimeClass": "service",
  "writeSet": [
    "docs/architecture/local-dev-control-plane",
    "docs/global/local-dev-environment.md",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/devctl",
    "tooling/make/local-dev.mk",
    "tooling/scripts/local-dev/machine-dev-registry.mjs",
    "tooling/scripts/local-dev/machine-dev.mjs",
    "tooling/scripts/local-dev/machine-dev.test.mjs",
    "tooling/skills/pt-local-dev-env/SKILL.md"
  ],
  "readSet": [
    "apps/station/app/subserver/app_meta"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "station-source-aware-static",
      "command": "git diff --check && node --check tooling/devctl/station.mjs && node --check tooling/devctl/profile.mjs && node --check tooling/scripts/local-dev/machine-dev-registry.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "station-source-aware-focused",
      "command": "node --test tooling/devctl/test/station.test.mjs tooling/devctl/test/profile.test.mjs tooling/scripts/local-dev/machine-dev.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "machine-dev-registry-self",
      "command": "python3 tooling/scripts/acceptance-run.py --gate machine-dev-registry-self",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "The source commit is integrated without restoring old Git history",
    "Target-only Profile override and Chat Acceptance registry changes remain",
    "Healthy source-matched Station reuse and stale-build deployment are tested",
    "The stable machine-dev-registry-self Gate passes"
  ],
  "failureBehavior": [
    "Do not reuse a Station from health alone",
    "Do not overwrite newer target-branch behavior",
    "Do not weaken typed deployment errors",
    "Do not push or rewrite history"
  ],
  "updatedAt": "2026-09-28T06:20:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- Source commit `9e4c0627b` is ready in `peers-touch-master`.
- `peers-touch-git` is clean at `63289d4d3`.
- Four overlapping files have compatible target-only changes that must be
  preserved during integration.
