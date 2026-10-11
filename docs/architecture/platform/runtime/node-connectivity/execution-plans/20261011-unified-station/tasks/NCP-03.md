# NCP-03: Atomic Native Transport Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-03", "workstreamId": "NCP-TRANSPORT",
  "title": "Switch all production consumers to one standard transport and verify native Chat",
  "workClass": "refactor", "completionClass": "functional", "executionMode": "build",
  "closureId": "ncp-native-cut", "journeyId": "NCP-G03", "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/frame", "apps/station/app", "apps/desktop/src-tauri", "apps/mobile/src-tauri", "apps/desktop/src/services", "apps/mobile/src/services", "model", "packages", "tooling/acceptance", "tooling/scripts", "tooling/docker", "tooling/make", "docs"],
  "readSet": [],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 120},
  "checks": [
    {"id": "transport-build", "command": "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked", "verificationClass": "SOURCE_CHECK"},
    {"id": "mobile-contract", "command": "cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml --locked", "verificationClass": "SOURCE_CHECK"},
    {"id": "native-functional", "command": "python3 tooling/scripts/node-connectivity-journey.py --closure ncp-native-cut --functional", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "native-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate NCP-G03 --gate NCP-G07 --gate NCP-G08", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {"scope": "suite", "entryCheckId": "native-functional", "scenarioIds": ["NCP-G03", "NCP-G07", "NCP-G08"], "maxProvisioningRuns": 1, "maxClientLaunches": 2, "minWarmReuseRate": 0.66, "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": false},
  "doneWhen": ["One Host owns every runtime consumer; native clients/Federation/discovery use standard routes and canonical API.", "Real two-actor native text, delivered/read receipt and 32 MiB attachment pass receiver assertions.", "Renewal preserves healthy SSE; revoke/limit exhaustion recover with typed bounds.", "Custom WSS/mount framing, transport heartbeat/reconnect and obsolete message consumers are removed in one cut."],
  "failureBehavior": ["Keep the atomic cut open until every consumer and knowledge/doc reference is reconciled.", "No runtime fallback or blind write replay.", "Mobile compile evidence cannot claim native Mobile runtime completion."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

Current constructors, custom data-plane and consumer inventory are defined in
`integration.md`. The unrelated StationPicker change is excluded.

## Verification Contract

Native DOM events drive route choice, login, send and upload. The second native
client renders/decrypts, acknowledges delivery/read and verifies attachment digest.
Harness controls short reservation renewal, revocation, slow writer, oversize
and capacity rejection. Runtime owner prepares one exact-source Suite and cleanup.
No shared-service restart or new profile is authorized by this Task.
Reverting the self-contained cut is the only rollback, with matching deployment.
