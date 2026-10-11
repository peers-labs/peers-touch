# NCP-01: Logical Station Identity And Node Authorization

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-01", "workstreamId": "NCP-IDENTITY",
  "title": "Define and verify logical Station root delegation without changing active transport",
  "workClass": "refactor", "completionClass": "source", "executionMode": "build",
  "closureId": "ncp-identity", "journeyId": "NCP-G01", "runtimeClass": "source-only",
  "writeSet": ["model/domain/peer", "model/domain/federation", "apps/station/frame/core/plugin/native/subserver/bootstrap", "apps/station/frame/touch/model", "apps/desktop/src-tauri", "apps/mobile/src-tauri", "packages", "docs/architecture/platform/runtime/node-connectivity"],
  "readSet": ["apps/station/frame/core/plugin/native", "docs"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 60, "cleanupSeconds": 30},
  "checks": [
    {"id": "model-generation", "command": "./model/build.sh", "verificationClass": "SOURCE_CHECK"},
    {"id": "identity-verifier", "command": "go test ./apps/station/frame/core/plugin/native/subserver/bootstrap/... -run 'StationIdentity|NodeAuthorization|Route' -count=1", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": ["Canonical generated identity/delegation/route contracts and verifiers reject root, node, epoch, expiry and capability mismatch.", "Separate node keys retain existing logical Station identity; active production transport is unchanged."],
  "failureBehavior": ["Never trust a PeerID claim without key proof.", "No independent runtime model, public protocol version bump or user-data migration."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

Source basis: identity currently signs with a Host key. This closure is a
contract/library prerequisite; no product or cluster completion claim.

## Verification Contract

Generate contracts before consumers. Test two independent node keys under one
root and negative proof vectors, deterministic signing, byte caps and lifetime.
Native transport cut is deferred to NCP-03, so no parallel production listener
or parser fallback is introduced. NCP-G01 runtime proof belongs to NCP-02/08.
