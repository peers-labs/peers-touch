# W5-OWNER - Conversation Member Consumer Cutover

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W5-OWNER",
  "workstreamId": "W5",
  "title": "Cut Mobile member administration to Conversation authority",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W5-conversation-owner-source",
  "journeyId": "MS-J03..MS-J04-conversation-member-authority",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/chat/command.proto",
    "model/domain/chat/conversation.proto",
    "model/domain/chat/conversation_api.proto",
    "apps/station/app/subserver/conversation",
    "apps/station/frame/touch/model/chat/command.pb.go",
    "apps/station/frame/touch/model/chat/conversation.pb.go",
    "apps/station/frame/touch/model/chat/conversation_api.pb.go",
    "apps/desktop/src/gen/proto/domain/chat",
    "apps/desktop/src-tauri/src/messaging/transport.rs",
    "apps/mobile/src-tauri/src/commands/mod.rs",
    "apps/mobile/src-tauri/src/messaging",
    "apps/mobile/src-tauri/src/runtime/station_transport/mod.rs",
    "apps/mobile/src/gen/proto/domain/chat",
    "apps/mobile/src/services/mobileCommands.ts",
    "apps/mobile/src/services/stationTransport.ts",
    "apps/mobile/src/services/gateways/gatewayTypes.ts",
    "apps/mobile/src/services/gateways/groupGateway.ts",
    "apps/mobile/src/services/gateways/groupGateway.test.ts",
    "apps/mobile/src/features/group",
    "apps/mobile/src/pages/chat",
    "docs/architecture/api-ownership/README.md",
    "docs/architecture/api-ownership/decisions.md",
    "docs/architecture/api-ownership/proposals/20260918-conversation-member-authority-remote-routing-amendment.md",
    "docs/architecture/api-ownership/proposals/20260918-conversation-member-authority-remote-routing-review-prompt.md",
    "packages/locales",
    "packages/messaging-core"
  ],
  "readSet": [
    "model/domain/chat",
    "apps/station/app/subserver/conversation",
    "packages/messaging-core",
    "docs/architecture/api-ownership",
    "docs/architecture/mobile",
    "docs/architecture/messaging-platform"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "conversation-member-mobile",
      "command": "pnpm --dir apps/mobile exec vitest run src/services/gateways/groupGateway.test.ts src/features/group src/pages/chat",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "conversation-member-native",
      "command": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --lib --offline messaging",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "conversation-member-station",
      "command": "cd apps/station/app && go test -count=1 ./subserver/conversation/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "conversation-member-core",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml --offline",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "conversation-member-contracts",
      "command": "pnpm --dir apps/mobile run check",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Mobile member role and muted-until updates use the generated Conversation member-authority command",
    "Mobile ownership transfer uses the generated atomic Conversation ownership-transfer command",
    "Authoritative readback consumes the complete member snapshot, authority sequence and hash, membership epoch, and MLS epoch",
    "Stale sequence, stale epoch, role denial, idempotent replay, and typed owner errors remain visible",
    "Remote Home Stations authenticate and durably forward the exact actor-device-signed member-authority command through AUTHORITY_COMMAND",
    "A remote command result remains pending until the ordered member-authority event commits the local projection",
    "The two Mobile Group production callers are deleted with no Group-route alias or compatibility path"
  ],
  "failureBehavior": [
    "Do not create a Mobile or Group-owned member authority",
    "Do not split owner transfer into independent demote and promote calls",
    "Do not retain a retired Group fallback for rollback",
    "Required simulator runtime proof remains in W5-PROOF and W6A-PROOF; physical proof is optional diagnostics"
  ],
  "updatedAt": "2026-09-19T05:50:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "docs/architecture/api-ownership/proposals/20260918-conversation-member-authority.md"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "pnpm --dir apps/mobile exec vitest run (91 files, 659 tests); focused Group/chat slice (11 files, 50 tests)"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --lib --offline messaging (77 tests); cargo test --manifest-path packages/messaging-core/Cargo.toml --offline (110 unit + 2 integration tests)"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "pnpm --dir apps/mobile run check"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "python3 -m unittest apps/mobile/scripts/check_mobile_shell_contracts_test.py; pnpm --dir apps/mobile run check:mobile-shell-contracts; zero production references to group_member_update, group_ownership_transfer, /group-chat/member/update, or /group-chat/ownership/transfer"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "AO-D10A accepted; generated Go/Desktop TS/Mobile TS contracts include member-authority proposal and local-or-proposal route envelopes"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "cd apps/station/app && go test -count=1 ./subserver/conversation/..."
    }
  ]
}
```

## Objective

Consume the already accepted and implemented Conversation member authority,
then remove the two remaining Mobile Group member-administration callers.

## Current Snapshot

- AO-D10 member update and atomic ownership transfer contracts exist.
- Station Conversation implements authoritative transaction and readback
  semantics.
- The same-authority path now uses native deterministic
  `ConversationMemberAuthorityCommand` preparation and the two canonical
  protobuf routes.
- Ordered `member_authority_committed` events atomically replace the local
  member role/mute/deadline snapshot, owner, authority head, membership epoch,
  and unchanged MLS epoch before Mobile reports `projected`.
- The retired Group callers and their typed Web/Rust transport operations are
  deleted; source scans find no production reference to either legacy route.
- AO-D10A is accepted and implemented. The existing signed Conversation
  proposal carries either `ChatCommand` or the exact member-authority command;
  both canonical member routes accept local raw commands or remote signed
  proposals.
- The Home Station authenticates the actor/device, validates exact signed bytes,
  and durably forwards one `AUTHORITY_COMMAND`; the authority maps the same
  command through `SubmitForwarded` and the existing aggregate/UOW.
- Mobile persists the exact command in its existing command/outbox lifecycle.
  A forwarding/result acknowledgement remains `pending`; only the ordered
  `member_authority_committed` event atomically commits command state and the
  complete local authority projection.
- Social block authority is no longer bundled into this Task; `W5-SOCIAL` owns
  that independent source closure.

## Verification Snapshot

- Full Mobile Vitest: 91 files / 659 tests PASS.
- Focused Group and chat Vitest: 11 files / 50 tests PASS.
- Mobile Rust messaging: 77 tests PASS.
- Shared `messaging-core`: 110 unit + 2 integration tests PASS.
- Station Conversation Go packages PASS.
- Mobile TypeScript, production build, Rust check, and iOS project check PASS.
- Mobile contract checker and legacy Group authority source scan PASS.
- Runtime and formal Acceptance were not run; they remain owned by
  `W5-PROOF` and `W6A-PROOF`.
