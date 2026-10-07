# MICU-01 - Canonical Session Class Authority

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-infra-chat-usability-20261006",
  "taskId": "MICU-01",
  "workstreamId": "MICU-SESSION",
  "title": "Unify password, OAuth, and takeover Session class authority",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "MICU-01-session-class-authority",
  "journeyId": "SAL-J06",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/frame/core/facility/session",
    "apps/station/frame/touch/accessgate",
    "apps/station/frame/touch/auth",
    "apps/station/frame/touch/actor_handler.go",
    "apps/station/app/subserver/oauth",
    "apps/desktop/src-tauri/src/application/auth",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "docs/architecture/platform/station/access",
    "docs/client/desktop/identity-lifecycle.md"
  ],
  "readSet": [
    "docs/knowledge/invariants/mobile-session-device-identity.md",
    "docs/architecture/platform/client/mobile/design.md",
    "docs/client/mobile/lifecycle.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "station-session-class-unit",
      "command": "cd apps/station/frame && go test ./core/facility/session ./touch/accessgate ./touch/auth -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "station-oauth-session-class-unit",
      "command": "cd apps/station/app && go test ./subserver/oauth/... -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-auth-session-class-unit",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml application::auth",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "architecture-module-governance",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Password Access Gate, OAuth acknowledgement, and session takeover use the same canonical client-class policy",
    "Desktop and Mobile remain separate Session classes",
    "A new same-class Session revokes every older active same-class Session and preserves other classes",
    "Concurrent same-class activation converges to at most one active Session",
    "Desktop emits only the canonical desktop class and Mobile emits only mobile",
    "Existing non-canonical Session rows are normalized by a one-time migration without runtime aliases"
  ],
  "failureBehavior": [
    "Do not revoke every Session for the actor",
    "Do not scope takeover by device_id",
    "Do not retain desktop-native as a Session class alias",
    "Do not weaken Session and Messaging device_id equality"
  ],
  "updatedAt": "2026-10-06T01:06:57.000Z"
}
```

## Objective

Restore one Station-owned Session concurrency rule before any native usability
claim: one active Session per actor and canonical client class.

## Current Snapshot

- State: not started.
- Source baseline: the three credential paths currently use inconsistent
  replacement scopes.
- Next boundary: implement and prove one canonical class-slot authority.
