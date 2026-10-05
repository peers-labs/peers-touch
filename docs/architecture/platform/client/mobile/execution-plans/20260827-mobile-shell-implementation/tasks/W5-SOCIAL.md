# W5-SOCIAL - Social Relationship Authority

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W5-SOCIAL",
  "workstreamId": "W5",
  "title": "Implement Social-owned directional block, list, and status",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W5-social-authority-source",
  "journeyId": "MS-J02..MS-J06-social-authority",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/social",
    "model/domain/federation",
    "model/domain/mobile",
    "model/domain/realtime",
    "apps/station/app/subserver/social",
    "apps/station/frame/core/federation",
    "apps/station/frame/touch/model",
    "apps/mobile/src-tauri",
    "apps/mobile/src/gen/proto/domain/federation",
    "apps/mobile/src/gen/proto/domain/mobile",
    "apps/mobile/src/gen/proto/domain/realtime",
    "apps/mobile/src/gen/proto/domain/social",
    "apps/mobile/src/services/mobileCommands.ts",
    "apps/mobile/src/services/stationTransport.ts",
    "apps/mobile/src/services/gateways/socialGateway.ts",
    "apps/mobile/src/components/recovery",
    "apps/mobile/src/features/social",
    "apps/mobile/src/runtimes",
    "apps/desktop/src/gen/proto/domain/federation",
    "apps/desktop/src/gen/proto/domain/mobile",
    "apps/desktop/src/gen/proto/domain/realtime",
    "apps/desktop/src/gen/proto/domain/social",
    "docs/architecture/engineering/api-governance/station-api-capabilities.yaml",
    "docs/architecture/platform/client/mobile",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/platform/client/mobile",
    "docs/architecture/domains/social/runtime",
    "docs/architecture/shared/federation",
    "docs/architecture/engineering/api-governance"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 90
  },
  "checks": [
    {
      "id": "social-authority-station",
      "command": "(cd apps/station && go test -race -count=1 ./app/subserver/social/... ./frame/core/federation/...)",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "social-authority-mobile",
      "command": "pnpm --dir apps/mobile exec vitest run src/services/gateways src/features/social src/runtimes/socialProjectionRuntime.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "social-authority-contracts",
      "command": "pnpm --dir apps/mobile run check",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Generated Social block and unblock commands bind command identity, payload hash, deadline, actor, target, and authoritative result lookup",
    "Blocked-list and relationship-status projections are cursor-bounded, privacy-safe, and revisioned",
    "Block removes both visible follow directions while unblock never recreates them",
    "Same-Station and cross-Station enforcement converge through signed directional Federation events",
    "The four Mobile Social production callers use the canonical Social APIs with no Friend Chat fallback"
  ],
  "failureBehavior": [
    "Do not move block authority into Conversation, Mobile, or a projection store",
    "Do not disclose which remote actor blocked the viewer",
    "Do not restore follows or pending relationship eligibility on unblock",
    "Do not retain aliases, dual writes, or retired Friend Chat fallback calls",
    "Required simulator runtime proof remains in W5-PROOF; physical proof is optional diagnostics"
  ],
  "updatedAt": "2026-09-18T22:55:09.000Z"
}
```

## Objective

Close the missing public Social relationship authority and cut the four Mobile
block, unblock, blocked-list, and relationship-status consumers from retired
Friend Chat routes.

## Current Snapshot

- Social owns one directional relationship state table; startup migration moves
  legacy blocked rows into it and deletes the retired block rows.
- Generated block/unblock commands bind actor, target Home Station, observed
  revision, deadline, device signature, exact payload hash, terminal result,
  and authenticated result lookup.
- Block atomically removes both follow directions and accepted relationship
  projections. Unblock changes only the directional deny state and restores
  nothing.
- Signed, ordered Federation relationship events converge same-Station and
  cross-Station deny projections; realtime invalidation triggers authoritative
  Mobile refresh without exposing the remote block direction.
- The four Mobile callers use canonical Social APIs. Mutations use the existing
  encrypted durable command owner and list/status reads are cursor-bounded
  generated projections.
- Conversation member authority is handled separately by `W5-OWNER`.
- Required simulator evidence remains `UNPROVEN` and belongs to `W5-PROOF`;
  physical evidence is optional diagnostics.

## Verification Snapshot

- Station Social and shared Federation race checks PASS.
- Focused Mobile Social/Gateway tests: 18 files / 170 tests PASS.
- Mobile Rust library: 204 tests PASS.
- Mobile TypeScript/build/Rust/iOS project checks PASS.
- Station API ownership, Mobile hard-cut, Proto lint, and diff hygiene PASS.
