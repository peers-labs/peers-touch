# NCP-02: Standard Secure Stream With Canonical Handlers

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-02", "workstreamId": "NCP-TRANSPORT",
  "title": "Prove Circuit and Frame HTTP2 adapters as an internally complete library boundary",
  "workClass": "refactor", "completionClass": "functional", "executionMode": "build",
  "closureId": "ncp-standard-stream", "journeyId": "NCP-G02", "runtimeClass": "service",
  "writeSet": ["apps/station/frame/core/plugin/native", "apps/station/frame/core/plugin/server", "apps/station/frame/core/server", "model", "packages", "tooling/acceptance", "tooling/scripts", "docs"],
  "readSet": ["apps/station/app"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "frame-stream-source", "command": "go test ./apps/station/frame/core/plugin/native/transport/... ./apps/station/frame/core/plugin/server/... -count=1", "verificationClass": "SOURCE_CHECK"},
    {"id": "stream-functional", "command": "python3 tooling/scripts/node-connectivity-journey.py --closure ncp-standard-stream --functional", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "stream-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate NCP-G01 --gate NCP-G02", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {"scope": "suite", "entryCheckId": "stream-functional", "scenarioIds": ["NCP-G01", "NCP-G02"], "maxProvisioningRuns": 1, "maxClientLaunches": 1, "minWarmReuseRate": 0.5, "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": false},
  "doneWhen": ["Real direct and Circuit connections authenticate two node keys and carry TLS/HTTP2 through existing handler wrappers.", "SSE Flush, streamed attachment body, cancellation and protobuf errors retain canonical semantics.", "Library unit is proven without another production listener; new Gate injection and Journey adapter exist."],
  "failureBehavior": ["Invalid delegation or SPKI fails before credentials.", "Do not infer HTTP2 parity from Hertz HTTP1 source or change domain API."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

The pinned Circuit library exposes ACL/resources/reservation. Current Hertz
uses HTTP1 streaming; a supported standard adapter must be verified.

## Verification Contract

Suite harness creates isolated library processes, uses canonical registered
handlers and observes response/SSE/body semantics at receiver. Gate is attach-only.
No ordinary user workflow is proven yet. Production consumers switch in NCP-03;
new library code has no enabled alternate data-plane registration.
