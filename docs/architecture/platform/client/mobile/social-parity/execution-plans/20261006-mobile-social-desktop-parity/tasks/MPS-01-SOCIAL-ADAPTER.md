# MPS-01-SOCIAL-ADAPTER - Typed Social Adapter And Facade

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-01-SOCIAL-ADAPTER",
  "workstreamId": "MPS-FOUNDATION",
  "title": "Hard-cut Mobile Social to one typed Rust adapter and one generation-scoped facade",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "mps-social-adapter",
  "journeyId": "MSP-J01-J04-J05-J09",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/features/social",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "apps/mobile/src-tauri/src/social",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/station",
    "docs/architecture/domains/social/core",
    "docs/architecture/domains/social/cross-station",
    "docs/architecture/shared/federation",
    "docs/architecture/shared/security/secure-content",
    "model/domain/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "mps-adapter-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social src/runtimes/privateMomentsRuntime.test.ts src/services/gateways/momentsGateway.test.ts && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml social",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-adapter-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-facade-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mps-adapter-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-facade-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mps-adapter-old-path-removal",
      "command": "if rg -n 'createMomentsGateway|MomentsGateway|privateMomentsRuntime' apps/mobile/src/pages apps/mobile/src/runtimes/socialProjectionRuntime.ts; then exit 1; else test $? -eq 1; fi",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Mobile Web consumes one immutable SocialExperienceProjection and dispatches one Social intent family",
    "Rust exposes typed authenticated public and private Social operations without exposing bearer tokens or key material",
    "Every projection and completion is fenced by Station, actor, device and generation",
    "Direct Web authenticated Social dispatch, page imports of private runtime and duplicate durable command ownership are removed",
    "Facade contract Gate proves typed mapping, teardown and zero old-path references"
  ],
  "failureBehavior": [
    "Do not add a second Social authority, hand-written domain enum, Web outbox or Federation client",
    "Do not retain a fallback to direct Web bearer fetch or public behavior for private intent",
    "Do not expose root keys, recovery secrets or Content PreKey private material to Web"
  ],
  "updatedAt": "2026-10-06T07:48:27.000Z"
}
```

## Objective

建立后续所有 Mobile Social surface 共用的唯一 transport、durability 和 projection
边界，并在同一 closure 删除被替换的 Web 直连路径。

## Current Snapshot

- Public feed uses Web gateway transport while private operations use a separate Native runtime.
- Pages can import public/private owners independently.
- Existing Rust Social code covers private operations but is not the single typed Social adapter.
