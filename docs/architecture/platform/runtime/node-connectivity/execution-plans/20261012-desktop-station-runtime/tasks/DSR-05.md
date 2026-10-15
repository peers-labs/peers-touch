# DSR-05: Binding, Identity And Failure Lifecycle

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DESKTOP-STATION-RUNTIME-20261012",
  "taskId": "DSR-05",
  "workstreamId": "DSR-LIFECYCLE",
  "title": "Prove endpoint-scoped identity, route fencing, replay policy and cleanup",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dsr-lifecycle",
  "journeyId": "DSR-G02",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src-tauri",
    "packages/station-libp2p-http",
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/features",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/capabilities/station-access.yaml",
    "tooling/scripts/node-connectivity-journey.py",
    "docs/architecture/platform/runtime/node-connectivity",
    "docs/architecture/platform/station/access"
  ],
  "readSet": [
    "apps/station/frame/core/plugin/native/relay",
    "apps/station/frame/core/plugin/native/subserver/relay"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "lifecycle-contract",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --lib",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "lifecycle-functional",
      "command": "python3 tooling/scripts/node-connectivity-journey.py --closure dsr-lifecycle --functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "lifecycle-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate DSR-G02 --gate NCP-G07",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "lifecycle-functional",
    "scenarioIds": ["DSR-G02", "NCP-G07"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "Native Desktop restart retains the same PeerID for one verified Relay scope, while a different Relay scope receives a different PeerID.",
    "Consumed private material stays replay-protected; fresh valid material reconnects the same Relay-scoped source identity.",
    "Same-Station failover revokes the old RouteLease without clearing Access scope; Station replacement tears down old scope before committing a new lifecycle generation.",
    "Safe reads retry at most once, idempotent writes require their key, interrupted ordinary mutations return AmbiguousOutcome, and saturated admission returns Overloaded.",
    "Repeated route/Station switches and process shutdown leave no owned listener, driver, route session or worker thread."
  ],
  "failureBehavior": [
    "Expired or replayed private grants fail typed and never fall back to public discovery.",
    "Wrong PeerID or SPKI fails before Station credentials.",
    "No acceptance hook may bypass the production owner or manufacture cleanup success."
  ],
  "updatedAt": "2026-10-13T00:00:00.000Z"
}
```

## Current Snapshot

Current Desktop identity is process-random and proxy workers have no explicit
cancellation or join. The target must make same-endpoint restart stable without
creating one installation-global identifier visible to unrelated Relays.

## Verification Contract

One isolated native Suite records source PeerIDs across restart and two Relay
scopes, exercises consumed/fresh material, read/mutation failures, short
renewal/revocation and repeated switches, then verifies owner resource counts
and cleanup receipts through production observations.
