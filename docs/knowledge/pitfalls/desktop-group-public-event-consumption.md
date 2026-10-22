---
kind: pitfall
title: Clients must consume every Group public lifecycle fact
status: active
owns:
  - packages/messaging-core/src/inbox/public_event.rs
  - apps/desktop/src-tauri/src/messaging/engine.rs
  - apps/desktop/src-tauri/src/messaging/store.rs
  - apps/mobile/src-tauri/src/messaging/engine.rs
  - apps/mobile/src-tauri/src/messaging/adapter.rs
referenced-by: []
related:
  - ../../architecture/domains/chat/messaging/design.md
  - ../../architecture/domains/chat/messaging/decisions.md
detected: 2026-10-18
---

# Clients must consume every Group public lifecycle fact

## Symptom

Native cross-Station Chat completed message interactions, transport retry,
offline recovery, duplicate delivery and Station restart, then timed out waiting
for Group rename convergence. The receiver logged
`messaging public-event payload type is unsupported`.

## Root cause

The Desktop public-event consumer handled message facts but omitted
`ConversationUpdated`, `ConversationDissolved` and `MemberAuthorityCommitted`.
Durable command submission could therefore succeed while the first lifecycle
fact stopped the ordered Device Inbox lane. Existing receive structs alone did
not provide an executable consumer or a transactional Store implementation.

## Mitigation

### What was done in code

Messaging Core owns public-event validation and the shared
`PublicEventProcessor`. Desktop and Mobile compose that processor and provide
typed repository adapters for their atomic receive transactions. The adapters
preserve all member metadata and check the exact locally owned command before
committing its intent. A Group with its sole remaining Owner is a valid active
projection.

### What guards against regression

`portable_public_event_processor_commits_group_update_and_dissolve` exercises
the shared processor through Desktop's real adapter and checks rename,
terminal state, exact command commit and the lane checkpoint.
`core_member_authority_adapter_commits_the_exact_local_intent` checks the
member-authority transaction through the shared repository port.
`conversation_mutation_readback_mismatch_rolls_back_lane_and_local_intent`
proves a contradictory result changes no projection, command, head, receipt or
lane cursor. The Native lifecycle Gate requires receiver-visible rename, role,
Owner transfer, mutation by the new Owner, leave, dissolve and restart history.

## How to detect a recurrence

From the repository root:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml portable_public_event_processor --offline
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml core_member_authority_adapter --offline
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml conversation_mutation_readback_mismatch --offline
```

With reviewed remote Profiles and the required reset authorization:

```bash
python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --station-profile station-four=four --station-profile station-five=fiveArm --gate chat-lifecycle-interactions-group-e2e
```

## Crosswalks

MP-D13 and MP-D14 require ordered Authority facts and the same atomic marker,
projection, cursor and ACK boundary for the sending endpoint and recipients.
