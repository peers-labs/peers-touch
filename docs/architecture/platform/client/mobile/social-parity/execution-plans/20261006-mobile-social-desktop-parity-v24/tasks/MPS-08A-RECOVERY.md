# MPS-08A-RECOVERY - Trusted Private History Recovery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-08A-RECOVERY",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Recover unseen historical private Moments on a new trusted Mobile device",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "mps-recovery",
  "journeyId": "MSP-J06",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/moments",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "apps/mobile/src/acceptance",
    "apps/mobile/src-tauri/Cargo.toml",
    "apps/mobile/src-tauri/Cargo.lock",
    "apps/mobile/src-tauri/src/lib.rs",
    "apps/mobile/src-tauri/src/commands/mod.rs",
    "apps/mobile/src-tauri/src/platform",
    "apps/mobile/src-tauri/src/social",
    "apps/mobile/src-tauri/plugins/secure-input",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
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
      "command": "pnpm --dir apps/mobile exec vitest run src/runtimes/privateMomentsRuntime.test.ts src/features/social/mobileSocialFacade.test.ts src/acceptance/actions.privateSocial.test.ts src/pages/moments src/components/recovery && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml social && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml secure_input && pnpm --dir apps/mobile run check:web && ! rg -n \"recoveryPhrase|storeRecoveryPhrase|social_private_store_recovery_phrase\" apps/mobile/src apps/mobile/src-tauri/src/commands apps/mobile/src-tauri/src/social && git diff --check",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Historical private content projects recovery-required rather than blank or corrupt content",
    "The source path can recover a never-opened historical Moment for a replacement device without bypassing current authorization",
    "Recovery phrase, root material, device private keys and envelope secrets never enter Web or screenshots",
    "Web and the Acceptance registry initiate recovery without a phrase or secret handle; only the masked native control returns the phrase to Rust",
    "Acceptance-only native autofill consumes a single-use process-scoped secret channel without Web, Appium payload or evidence disclosure",
    "The phrase-bearing TypeScript, Tauri and Web Acceptance contracts have zero active references",
    "The architecture registry governs the created secure-input plugin and Rust adapter paths in the same source cut",
    "Invalid recovery input returns no partial plaintext or retained key reference",
    "Recovery-required and integrity-failed surfaces retain exact Moment identity and bounded recovery actions"
  ],
  "failureBehavior": [
    "Do not synthesize history, bypass device authorization or expose recovery material to Web",
    "Do not convert integrity failure into generic retry",
    "Do not use a revoked-device assertion to substitute for the separate revocation closure",
    "Do not claim Bob2 Native functional recovery before MPS-10 proves RC08"
  ],
  "updatedAt": "2026-10-06T10:11:00.000Z"
}
```

## Objective

只关闭 MSP-J06 的 trusted recovery 用户结果，使 Bob2 能恢复未读历史，同时保持
Secure Content 密钥边界。

## Current Snapshot

- Rust private Social contains recovery primitives.
- The current phrase-bearing TypeScript/Tauri/Acceptance path violates MSP-J06
  and is deleted by this closure.
- Recovery-required state is not fully connected to the primary Moments experience.
- New-device unseen-history readback lacks a dedicated Mobile closure.
