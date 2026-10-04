# W6B-MEDIA-RENDER - Encrypted Moment Image Rendering

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6B-MEDIA-RENDER",
  "workstreamId": "W6B",
  "title": "Resolve and decrypt encrypted Moment images",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "W6B-media-render-source",
  "journeyId": "MS-J05-media-render",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/services/gateways/momentMediaGateway.ts",
    "apps/mobile/src/services/gateways/momentMediaGateway.test.ts",
    "apps/mobile/src/pages/moments/MomentImage.tsx",
    "apps/mobile/src/pages/moments/MomentImage.test.tsx",
    "apps/mobile/src/pages/moments/MomentFeedItem.tsx",
    "apps/mobile/src/pages/moments/MomentFeedItem.test.ts",
    "tooling/acceptance/features/mobile-moments-participation.yaml",
    "tooling/acceptance/registry.yaml"
  ],
  "readSet": [
    "packages/client-media-security",
    "apps/station/app/subserver/oss",
    "docs/architecture/mobile"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "moments-media-render-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/services/gateways/momentMediaGateway.test.ts src/pages/moments/MomentImage.test.tsx src/pages/moments/MomentFeedItem.test.ts",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Encrypted Moment image CIDs resolve through the authenticated Station OSS endpoint",
    "Ciphertext and plaintext hashes are verified through the shared client-media-security decryptor",
    "Rendered object URLs are revoked on replacement and unmount",
    "Load or decrypt failure is visible and retryable without rendering raw encrypted CIDs"
  ],
  "failureBehavior": [
    "Do not render encrypted object URLs or ciphertext as images",
    "Do not duplicate media cryptography in Mobile",
    "Descriptor-bearing restored drafts and private-audience envelopes remain owner-blocked"
  ],
  "updatedAt": "2026-09-17T03:40:00.000Z"
}
```

## Objective

Complete the accepted encrypted-media read path for already-published Moments
using the existing Station OSS endpoint and shared media-security contract.

## Current Snapshot

- Moment upload always encrypts bytes and publishes `media_encryption`.
- The feed currently sends the stored CID directly to `<img>`, so encrypted
  images cannot render.
- Shared descriptor normalization, hash verification, and decryption already
  exist in `packages/client-media-security`.

## Source Closure

- Same-Station `oss://` references resolve through authenticated
  `/sub-oss/file`; foreign public references are fetched without disclosing the
  active Station bearer token.
- Published image descriptors are normalized and decrypted only through
  `@peers-touch/client-media-security`, which verifies ciphertext and plaintext
  commitments before returning renderable bytes.
- `MomentImage` creates object URLs only from verified plaintext and revokes
  them on replacement, decode failure, cancellation, and unmount.
- Feed image failures remain visible and retryable; raw CIDs and encrypted
  bytes are never assigned to `<img src>`.
- Private-audience key envelopes and descriptor-bearing restored drafts remain
  outside this source slice.
- Acceptance ownership now includes the media gateway and Moment renderer so
  later proof selection cannot miss this path.

## Verification Snapshot

- Focused media gateway/renderer/feed suite: 11/11 PASS.
- Broader Moments source suite: 64/64 PASS.
- Shared client-media-security suite: 4/4 PASS.
- Mobile Web checks and scoped diff validation: PASS.
- Formal Moments Acceptance remains deferred until the source frontier closes.

## Concurrency Decision

- This slice is independent of feed pagination, draft persistence, Settings,
  and native lifecycle work.
- Execute serially as the current Task; no second media authority is permitted.
