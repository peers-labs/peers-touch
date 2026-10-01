# OLB-LIVE-01: OAuth Live-Readiness Source Cutover

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-LIVE-20261001",
  "taskId": "OLB-LIVE-01",
  "workstreamId": "OLB-LIVE",
  "title": "Complete native handoff, provider identity, and refresh durability source changes",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "olb-live-native-handoff",
  "journeyId": "OLB-J05",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/oauth2-client/internal/application/oauth/usecase",
    "apps/oauth2-client/internal/bootstrap",
    "apps/oauth2-client/internal/domain/oauth",
    "apps/oauth2-client/internal/infrastructure/persistence/github",
    "apps/oauth2-client/internal/infrastructure/persistence/memory",
    "apps/oauth2-client/internal/infrastructure/provider/github",
    "apps/oauth2-client/internal/interfaces/http/handler",
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
    "apps/desktop/src-tauri/src/infrastructure/auth_identity/mod.rs",
    "apps/station/app/subserver/oauth",
    "apps/station/frame/core/auth/oauth2.go",
    "apps/station/frame/touch/actor_handler.go",
    "apps/station/frame/touch/actor_router.go",
    "apps/station/frame/touch/auth",
    "apps/station/frame/touch/oauth_handler.go",
    "apps/station/frame/touch/model/db/oauth2_state.go",
    "apps/station/frame/touch/model/db/automigrate.go",
    "model/domain/oauth/oauth.proto",
    "model/domain/oauth/broker_bridge.proto",
    "apps/station/frame/touch/model/oauth.pb.go",
    "apps/station/frame/touch/model/oauthbridge",
    "apps/desktop/src/gen/proto/domain/oauth/oauth_pb.ts",
    "apps/desktop/src/gen/proto/domain/oauth/broker_bridge_pb.ts",
    "apps/mobile/src/gen/proto/domain/oauth",
    "docs/global/coding-guide/desktop/service-api.md",
    "docs/architecture/oauth-login-broker",
    "docs/architecture/acceptance-framework/coverage-report.md",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/station-access-lifecycle",
    "docs/client/desktop/runtime-projections.md",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "olb-live-bridge-go",
      "command": "cd apps/station && go test ./app/subserver/oauth ./frame/touch ./frame/touch/auth",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-bridge-desktop",
      "command": "cd apps/desktop && pnpm run check && cargo test --manifest-path src-tauri/Cargo.toml oauth",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-provider-go",
      "command": "cd apps/oauth2-client && go test -race ./internal/application/oauth/usecase ./internal/infrastructure/provider/github ./internal/interfaces/http/handler",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-refresh-race",
      "command": "cd apps/oauth2-client && go test -race ./internal/application/oauth/usecase ./internal/infrastructure/persistence/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-mobile-proto",
      "command": "tooling/scripts/proto-gen-mobile.sh web && cd apps/mobile && pnpm run check",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Logged-out Desktop account login no longer requires an existing actor or token",
    "Loopback callback validation accepts only the explicit template contract",
    "Broker and Station canonical signature implementations are covered by focused tests",
    "Signed assertions bind one purpose and are consumed once through Station persistence",
    "Station bridge route registration and missing-secret failure are covered by focused tests",
    "Broker account login is bound to a canonical Access Attempt and all later Station gates",
    "Station keeps the candidate session inactive until Desktop durable persistence is acknowledged",
    "Desktop source persists the candidate credential before acknowledgement and marks Station binding complete only after activation",
    "A lost acknowledgement response preserves a durable local recovery record and converges through polling or restart without cancelling an active Station session",
    "Desktop uses the native loopback expiry supplied by Rust and sends cancellation before reporting timeout",
    "Station performs startup and periodic expiry sweeps without waiting for another OAuth request",
    "Expired or cancelled loopback attempts remove Desktop pending state and revoke any unacknowledged Station candidate credential",
    "Desktop and Mobile generated OAuth bindings match the canonical shared proto sources",
    "Connector-link source uses a separate authenticated route that does not issue an account-login session",
    "Provider denial uses the transaction-owned receiver and is durably audited",
    "GitHub private email resolves only through the verified-primary email endpoint",
    "No-email providers receive a stable provider-scoped Station identity",
    "A durable refresh claim exists before provider mutation and unresolved claims fail closed"
  ],
  "failureBehavior": [
    "Do not place the bridge secret in Desktop",
    "Do not add a second callback transport",
    "Do not retain an active local identity after bridge failure",
    "Do not trust callback-supplied site identity or unverified provider email",
    "Do not retry a rotating refresh token after an unresolved durable claim"
  ],
  "updatedAt": "2026-10-01T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- The broker and Station reconstruct different signature bytes.
- The Station route exists as a constant and handler but is not registered.
- Account login reuses a connector command that requires an existing actor.

## Closure

One source cutover closes the signed native handoff, provider identity, denial,
and durable refresh boundaries before integrated runtime proof.

## Concurrency Decision

- Mode: serial.
- Reason: proto, broker, Station, Desktop, and refresh storage contracts must
  cut over atomically before the clean-source functional proof.
