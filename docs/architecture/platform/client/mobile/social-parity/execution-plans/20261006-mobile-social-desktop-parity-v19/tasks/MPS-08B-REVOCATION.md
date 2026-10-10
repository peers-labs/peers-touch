# MPS-08B-REVOCATION - Delete Block And Device Revocation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-08B-REVOCATION",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Converge author delete, relationship loss, block and device revoke across every Mobile Social surface",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "mps-revocation",
  "journeyId": "MSP-J08",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/moments",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "apps/mobile/src-tauri/src/social",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/station",
    "docs/architecture/domains/social/core",
    "docs/architecture/domains/social/cross-station",
    "docs/architecture/platform/client/mobile/social-parity",
    "docs/architecture/shared/security/secure-content"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 4200,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "mps-revocation-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social src/pages/moments src/runtimes/privateMomentsRuntime.test.ts && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml social",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Author delete, friend loss, block and device revoke stop new feed, detail, comment, media and recovery reads",
    "Ordered invalidation clears ordinary plaintext projection, object URLs and cached grants",
    "Affected surfaces show deleted-or-revoked with no hidden retry path",
    "A revoked device cannot recover, decrypt, open media or retain a readable projection",
    "User copy states the bounded guarantee without claiming remote erasure of maliciously saved copies"
  ],
  "failureBehavior": [
    "Do not infer revocation from missing content or reorder source-authoritative invalidations",
    "Do not preserve readable private cache after revoke",
    "Do not promise screenshot, export or malicious-copy deletion"
  ],
  "updatedAt": "2026-10-06T10:11:00.000Z"
}
```

## Objective

只关闭 MSP-J08 的 revocation 结果，让 delete、relationship loss、block 与 device revoke
在所有 Mobile surface 上按同一 source ordering 收敛。

## Current Snapshot

- Profile and Moments have partial delete/block primitives.
- Private cache, media and recovery invalidation are not one product closure.
- Revoked state is not uniformly visible across feed and exception Detail.
