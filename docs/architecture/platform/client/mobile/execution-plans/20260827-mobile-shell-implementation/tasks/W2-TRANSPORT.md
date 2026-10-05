# W2-TRANSPORT - Rust-Owned Authenticated Business Transport

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W2-TRANSPORT",
  "workstreamId": "W2",
  "title": "Move authenticated Mobile business transport behind Rust",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W2-transport-source",
  "journeyId": "MS-J01..MS-J07-authenticated-transport",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/scripts/check-mobile-shell-contracts.py",
    "apps/mobile/scripts/check_mobile_shell_contracts_test.py",
    "apps/mobile/src-tauri/src/commands",
    "apps/mobile/src-tauri/src/error.rs",
    "apps/mobile/src-tauri/src/lib.rs",
    "apps/mobile/src-tauri/src/messaging",
    "apps/mobile/src-tauri/src/runtime/oauth",
    "apps/mobile/src-tauri/src/runtime/station_transport",
    "apps/mobile/src/acceptance",
    "apps/mobile/src/features/auth",
    "apps/mobile/src/features/chat",
    "apps/mobile/src/features/group",
    "apps/mobile/src/features/social",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services/gateways",
    "apps/mobile/src/services/mobileCommands.ts",
    "apps/mobile/src/services/stationTransport.ts",
    "apps/mobile/src/services/stationTransport.test.ts"
  ],
  "readSet": [
    "docs/architecture/platform/client/mobile",
    "docs/architecture/domains/chat/messaging",
    "model/domain"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "mobile-transport-rust",
      "command": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --lib",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-transport-web-boundary",
      "command": "pnpm --dir apps/mobile run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-transport-hard-cut",
      "command": "python3 -m unittest apps/mobile/scripts/check_mobile_shell_contracts_test.py && pnpm --dir apps/mobile run check:mobile-shell-contracts",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Web code cannot read or attach bearer credentials for authenticated business operations",
    "Rust exposes a typed operation allowlist and rejects arbitrary proxy URLs, origins, methods, and headers",
    "Station, actor, lifecycle generation, refresh, redirect, and cancellation fencing are covered by focused tests",
    "All migrated gateways preserve generated request and response validation"
  ],
  "failureBehavior": [
    "Do not expose credentials or a generic authenticated fetch command to Web code",
    "Do not retain a Web bearer fallback for rollback",
    "Transport failure must preserve typed operation context without leaking secrets",
    "Required simulator runtime proof remains in W2-PROOF; physical proof is optional diagnostics"
  ],
  "updatedAt": "2026-09-18T14:05:00.000Z"
}
```

## Objective

Make Rust the only Mobile credential holder and authenticated business
transport owner while preserving generated domain contracts at the Web
boundary.

## Current Snapshot

- Rust owns secure credentials, fixed authenticated operation mapping,
  redirect rejection, request bounds, cancellation, and SSE lifecycle.
- Web submits only typed operation inputs and a credential-free session scope;
  static checks reject production bearer or refresh-token access.
- Gateway, Messaging, media/avatar, OSS, presence, realtime, and logout callers
  use their native owners while preserving generated response validation.
- Source and structural checks pass. Runtime and formal Acceptance remain
  `UNPROVEN` in `W2-PROOF`.
- Git checkpoint remains pending because the existing index contains unrelated
  Task changes and cannot be committed as one W2-TRANSPORT unit.
