# NCP-07: Shared Objects And Fenced OSS Workers

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-07", "workstreamId": "NCP-FENCING",
  "title": "Make object readback and lifecycle workers safe on multiple nodes",
  "workClass": "refactor", "completionClass": "functional", "executionMode": "build",
  "closureId": "ncp-shared-objects", "journeyId": "NCP-G06-OSS", "runtimeClass": "service",
  "writeSet": ["apps/station/app/subserver/oss", "apps/station/app/conf", "model/domain/oss", "apps/station/frame/touch/model", "tooling/acceptance", "tooling/scripts", "docs"],
  "readSet": ["apps/station/frame", "apps/station/app"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "oss-source", "command": "go test ./apps/station/app/subserver/oss/worker/... -count=1", "verificationClass": "SOURCE_CHECK"},
    {"id": "oss-functional", "command": "python3 tooling/scripts/node-connectivity-journey.py --closure ncp-shared-objects --functional", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "oss-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate NCP-G06-OSS", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {"scope": "suite", "entryCheckId": "oss-functional", "scenarioIds": ["NCP-G06-OSS-READ", "NCP-G06-OSS-GC", "NCP-G06-OSS-STALE"], "maxProvisioningRuns": 1, "maxClientLaunches": 2, "minWarmReuseRate": 0.66, "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": false},
  "doneWhen": ["Cluster object backing is shared; upload on A and authorized read on B returns matching digest.", "Existing OSS worker lock port uses shared fenced ownership; concurrent GC preserves quotas/refcounts.", "GC claims immutable generations; stale deletion cannot remove replacement bytes, stale completion is rejected, and local-only backing cannot declare cluster readiness."],
  "failureBehavior": ["No second job queue or new scheduler service.", "No automatic local-storage migration, reset or data deletion outside run namespace.", "Object backend failure remains an explicit OSS error."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

OSS now supplies a database-time node/incarnation/token lease through the
existing scheduler lock port. Blob metadata carries immutable generation and
physical storage-key identity; `local` remains single-node, while `shared-fs`
and S3 can satisfy cluster-shared backing.

## Verification Contract

Harness uploads namespaced bytes through A and reads through B; compare full
digest and auth. Race existing lifecycle workers, expire/takeover lock and resume
stale process after replacement upload; immutable generation bytes, metadata and
refcount readback prove the replacement survives and stale completion is rejected.
Deletes are bounded to Suite namespace. Existing user objects are never migrated.
