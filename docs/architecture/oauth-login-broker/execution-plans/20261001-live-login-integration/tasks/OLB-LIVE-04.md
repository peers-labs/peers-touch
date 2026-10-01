# OLB-LIVE-04: Integrated Proof And Environment Handoff

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-LIVE-20261001",
  "taskId": "OLB-LIVE-04",
  "workstreamId": "OLB-LIVE",
  "title": "Prove the integrated source and define isolated live inputs",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-live-proof",
  "journeyId": "OLB-J05",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "docs/architecture/oauth-login-broker",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "tooling/acceptance",
    "tooling/docker/compose.yml"
  ],
  "readSet": [
    "apps/oauth2-client",
    "apps/desktop/src/kernel/identityRuntime.ts",
    "apps/desktop/src/pages/login",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/store/oauth2.ts",
    "apps/desktop/src/store/session.ts",
    "apps/desktop/src-tauri/build.rs",
    "apps/desktop/src-tauri/src/application/auth",
    "apps/desktop/src-tauri/src/application/oauth2",
    "apps/desktop/src-tauri/src/contracts.rs",
    "apps/desktop/src-tauri/src/interface/contracts/mod.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/oauth2.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/model/mod.rs",
    "apps/station/app/subserver/oauth",
    "apps/station/frame/core/auth/oauth2.go",
    "apps/station/frame/touch/actor_handler.go",
    "apps/station/frame/touch/auth/oauth_bridge.go",
    "apps/station/frame/touch/oauth_handler.go",
    "model/domain/oauth/oauth.proto",
    "model/domain/oauth/broker_bridge.proto",
    "apps/station/frame/touch/model/oauth.pb.go",
    "apps/station/frame/touch/model/oauthbridge",
    "apps/desktop/src/gen/proto/domain/oauth/oauth_pb.ts",
    "apps/desktop/src/gen/proto/domain/oauth/broker_bridge_pb.ts",
    "docs/architecture/station-access-lifecycle",
    "docs/client/desktop",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "olb-live-all-go",
      "command": "cd apps/oauth2-client && go test -race ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-station",
      "command": "cd apps/station && go test ./frame/touch ./frame/touch/auth",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-desktop",
      "command": "cd apps/desktop && pnpm run check && pnpm run test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-architecture",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-integrated-functional",
      "command": "make dev-functional-result WORK_ITEM=OLB-LIVE-04 RUNTIME_CELL=desktop-macos-native REASON='verify native Desktop OAuth login against the isolated oauth2-client-test profile'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-live-acceptance",
      "command": "make acceptance-run-completion",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All focused regression suites pass",
    "Local exact-source Desktop-to-Station login Journey reaches FUNCTIONAL_PASS",
    "Acceptance gates select bridge, denial, no-email, and refresh-uncertainty regressions",
    "The env handoff lists required variable names and probes without secret values"
  ],
  "failureBehavior": [
    "Do not claim live provider or Vercel readiness from local fixtures",
    "Do not write the env repository from this source-bound conversation",
    "Do not log or persist secret values in evidence"
  ],
  "updatedAt": "2026-10-01T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- `oauth-login-broker-handoff-contract` proves source behavior only and is not
  native Desktop evidence.
- The separate environment repository now contains the authorized
  `oauth2-client-test` broker and remote Station definition.

## Native Functional Proof

`pt-dev-runtime-handoff` must run `OLB-J05` against the exact
`oauth2-client-test` profile. The run must use the real native Tauri window,
the profile-bound test broker and Station, and an isolated non-production
provider application.
Its source-bound result must prove callback receipt, Access Gate continuation
when present, local durable persistence, Station acknowledgement, authenticated
shell entry, restart recovery, timeout cancellation, and cleanup. Browser-only,
source/unit, or broker-only evidence cannot satisfy this check.

## Closure

The source is locally integrated and the next target-bound environment Plan can
provision and execute live provider scenarios without production reuse.

## Concurrency Decision

- Mode: serial.
- Reason: proof consumes all preceding source closures.
