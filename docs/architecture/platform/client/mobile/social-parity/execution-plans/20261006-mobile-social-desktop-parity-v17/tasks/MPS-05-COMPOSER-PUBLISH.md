# MPS-05-COMPOSER-PUBLISH - Atomic Audience Composer And Publish

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-05-COMPOSER-PUBLISH",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Atomically replace the three-Audience subset with all canonical Audience and publish paths",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "mps-composer-publish",
  "journeyId": "MSP-J04",
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
    "docs/architecture/shared/security/secure-content",
    "model/domain/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 2100,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "mps-composer-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social/useMomentsDraft.test.ts src/pages/moments/MomentComposer.test.ts src/runtimes/privateMomentsRuntime.test.ts && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml social",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-composer-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-audience-composer-native",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "mps-audience-old-path-removal",
      "command": "for kind in PUBLIC FOLLOWERS FRIENDS CIRCLE GROUP CUSTOM_ALLOW CUSTOM_DENY SELF; do rg -q \"Audience_Kind\\\\.${kind}\" apps/mobile/src/features/social/socialAudience.ts || exit $?; done; rg -q 'DIRECT' apps/mobile/src/features/social/socialAudience.ts || exit $?; if rg -n 'AUDIENCE_OPTIONS' apps/mobile/src/pages/moments/MomentComposer.tsx; then exit 1; else test $? -eq 1; fi",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "One composer exposes Public, Followers, Friends, Circle, Group, Custom, Direct and Self and routes each through the Rust adapter",
    "Text and image publish work for every Audience; other authoring controls appear only when canonical capability advertises support",
    "Private publish performs readiness and persist-before-send without leaking plaintext to Station or OSS",
    "Invalid, oversized or unverifiable input commits no Post and consumes no private key material",
    "Timeout and cancellation expose admitted command truth and reconcile exact resource identity before retry"
  ],
  "failureBehavior": [
    "Do not dual-write public and private stores or retain a public fallback",
    "Do not advertise an authoring kind that the canonical capability does not support",
    "Do not lose or expose a plaintext draft after failed validation, backgrounding or restart"
  ],
  "updatedAt": "2026-10-06T10:11:00.000Z"
}
```

## Objective

在同一可回滚 source checkpoint 中把 full Audience、private readiness、media 和
durable command 接到 composer，并删除旧三类 selector，绝不暴露半接通的 Audience。

## Current Snapshot

- Public and private publish are separate product paths.
- Composer exposes only a subset of canonical Audience.
- Draft and command durability exist but are not one end-to-end canonical publish flow.
