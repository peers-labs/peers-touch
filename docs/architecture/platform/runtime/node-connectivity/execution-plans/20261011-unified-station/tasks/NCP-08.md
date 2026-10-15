# NCP-08: One Station, Two Nodes And Native Failover

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-08", "workstreamId": "NCP-CLUSTER",
  "title": "Combine shared owners and verify a real native journey through two Station nodes",
  "workClass": "refactor", "completionClass": "functional", "executionMode": "build",
  "closureId": "ncp-cluster-journey", "journeyId": "NCP-G04", "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/frame", "apps/station/app", "apps/desktop/src-tauri", "model", "packages", "tooling/acceptance", "tooling/scripts", "tooling/docker", "tooling/make", "docs"],
  "readSet": ["apps/mobile/src-tauri"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 600, "cleanupSeconds": 120},
  "checks": [
    {"id": "cluster-source", "command": "go test ./apps/station/frame/core/plugin/native/node/... ./apps/station/frame/core/runtime/role/... -count=1", "verificationClass": "SOURCE_CHECK"},
    {"id": "cluster-functional", "command": "python3 tooling/scripts/node-connectivity-journey.py --closure ncp-cluster-journey --functional", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "cluster-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate NCP-G04 --gate NCP-G05 --gate NCP-G06", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {"scope": "suite", "entryCheckId": "cluster-functional", "scenarioIds": ["NCP-G04", "NCP-G05", "NCP-G06"], "maxProvisioningRuns": 1, "maxClientLaunches": 2, "minWarmReuseRate": 0.66, "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": false},
  "doneWhen": ["Node readiness validates root authorization, shared DB/keyring/object backing, schema and cluster-safe enabled owners.", "Real two-actor native Chat receives cross-node text/receipt/attachment and resumes through B after A dies within 30 seconds.", "Same logical Station scope survives failover with ordered device-safe events and no duplicate durable mutation.", "Peer boot and fencing/OSS subcontracts coexist without corrupting healthy work."],
  "failureBehavior": ["Never publish clustered readiness when an enabled owner depends on local truth.", "No implicit storage migration, new profile or shared service restart.", "No client re-login or Actor identity replacement for a route change."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

NCP-04..07 are prerequisite domain closures; only this integrated closure can
claim two-node Station behavior, and only after actual native receiver proof.

## Verification Contract

One prepared Suite starts A/B with distinct PeerIDs and one root/shared owners,
plus two native Desktop actors. DOM events drive login/send/upload; sender A and
receiver B verify rendered plaintext, receipts and object digest. Harness kills
only owned A, checks lease/registry withdrawal and observes route/cursor recovery.
Continue native send/read on B without login; count acknowledged messages,
duplicate effects and unauthorized device deliveries against durable readback.
