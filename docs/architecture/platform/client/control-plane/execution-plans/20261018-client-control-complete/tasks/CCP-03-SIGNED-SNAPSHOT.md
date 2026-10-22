# CCP-03-SIGNED-SNAPSHOT - Snapshot Contract And Client Core

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-03-SIGNED-SNAPSHOT",
  "workstreamId": "CCP-PUBLICATION",
  "title": "Build the exact-byte snapshot contract and shared monotonic client verification core",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccp-signed-snapshot",
  "journeyId": "CCP-J06-CCP-J07",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/client_control",
    "apps/station/frame/touch/model/client_control",
    "apps/desktop/src/gen/proto/domain/client_control",
    "apps/mobile/src-tauri",
    "packages/client-control-core",
    "tooling/acceptance",
    "docs/architecture/platform/client/control-plane",
    "go.work"
  ],
  "readSet": [
    "model/domain/peer",
    "packages/station-trust"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "ccp-snapshot-source",
      "command": "./model/build.sh && cargo test --manifest-path packages/client-control-core/Cargo.toml --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-snapshot-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-snapshot-core-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccp-snapshot-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-snapshot-core-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "ccp-snapshot-functional",
    "scenarioIds": [
      "snapshot-exact-byte-signature",
      "snapshot-rollback-replay-expiry",
      "snapshot-cache-persistence-failure"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "One protobuf snapshot carries bounded Relay, Direct Station, and release sections and signs exact statement bytes with domain-separated Ed25519",
    "The Rust core verifies key, schema, channel, time, bounds, signature, equal-sequence byte identity, secure watermark, cache, and merge semantics",
    "Desktop and Mobile consume the same core through platform HTTP and secure-persistence ports",
    "Cache loss, persistence failure, invalid input, and unavailable network retain the last-known-good or embedded state",
    "Release projection filters platform, architecture, channel, expiry, and sequence but never executes or installs content"
  ],
  "failureBehavior": [
    "Never reserialize decoded protobuf for signature verification",
    "Never clear last-known-good client state after network, signature, persistence, or target-selection failure"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Close the shared consumption policy before platform adapters and publication
owners depend on the contract.

## Current Snapshot

- No Client Control proto, Rust core, or client signing keyring exists.
- Existing Station trust remains reusable but does not verify cloud snapshots.
- Publisher admission, ledger, signing, and promotion are deferred to CCP-03B.
