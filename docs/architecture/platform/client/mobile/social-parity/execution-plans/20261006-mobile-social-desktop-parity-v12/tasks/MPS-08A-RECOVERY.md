# MPS-08A-RECOVERY - Trusted Private History Recovery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-08A-RECOVERY",
  "workstreamId": "MPS-TRUST",
  "title": "Recover unseen historical private Moments on a new trusted Mobile device",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "mps-recovery",
  "journeyId": "MSP-J06",
  "runtimeClass": "native-mobile",
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
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "mps-recovery-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/runtimes/privateMomentsRuntime.test.ts src/pages/moments src/components/recovery && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml social",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-recovery-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-recovery-native",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mps-recovery-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-recovery-native",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Historical private content projects recovery-required rather than blank or corrupt content",
    "Bob2 completes trusted recovery and reads a Moment never opened on the old device",
    "Recovery phrase, root material, device private keys and envelope secrets never enter Web or screenshots",
    "Invalid recovery input returns no partial plaintext or retained key reference",
    "Recovery-required and integrity-failed surfaces retain exact Moment identity and bounded recovery actions"
  ],
  "failureBehavior": [
    "Do not synthesize history, bypass device authorization or expose recovery material to Web",
    "Do not convert integrity failure into generic retry",
    "Do not use a revoked-device assertion to substitute for the separate revocation closure"
  ],
  "updatedAt": "2026-10-06T07:33:51.000Z"
}
```

## Objective

只关闭 MSP-J06 的 trusted recovery 用户结果，使 Bob2 能恢复未读历史，同时保持
Secure Content 密钥边界。

## Current Snapshot

- Rust private Social contains recovery primitives.
- Recovery-required state is not fully connected to the primary Moments experience.
- New-device unseen-history readback lacks a dedicated Mobile closure.
