# NCP-09: Exact-Source Proof And Bounded Delivery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-09", "workstreamId": "NCP-PROOF",
  "title": "Validate final integrated source, formal proof and resource release",
  "workClass": "refactor", "completionClass": "acceptance-aggregate", "executionMode": "build",
  "closureId": "ncp-final-proof", "journeyId": "NCP-G08", "runtimeClass": "source-only",
  "writeSet": ["tooling/acceptance", "docs"],
  "readSet": ["apps/station/frame", "apps/station/app", "apps/desktop/src-tauri", "apps/mobile/src-tauri", "model", "packages", "tooling/scripts"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 600, "cleanupSeconds": 120},
  "checks": [
    {"id": "architecture-source", "command": "node tooling/scripts/architecture/module-governance.mjs validate", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "completion-proof", "command": "python3 tooling/scripts/acceptance-run.py --completion", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["All required Gate contracts exist and pass on the final source/artifact identity after native functional PASS.", "Single Host and full custom-data-plane removal inventory passes with canonical API ownership unchanged.", "Owned Suite resources have cleanup receipts and no unrelated user changes are included.", "Mobile runtime, performance superiority and external provider effects remain explicitly unproven unless separately exercised."],
  "failureBehavior": ["Focused source checks cannot establish product PASS.", "Do not import old broad iOS/release matrix or claim unrun Gates.", "No commit, push or PR without the exact operation grant."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

This Task aggregates evidence; no runtime lifecycle or completion state is stored
in this source package. Runtime owner controls retained Suite and cleanup.

## Verification Contract

Formal Gates attach to final exact-source manifests; no individual Gate creates
services/accounts or launches clients. Required native functional Journey must
already pass. If implementation changed since a result, invalidate and rerun
affected proof. Deliver a bounded source/proof summary, preserve backup history
and unrelated StationPicker edits, and release only owned resources.
