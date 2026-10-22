---
kind: pitfall
title: Desktop must consume every Group public lifecycle fact
status: active
owns:
  - apps/desktop/src-tauri/src/messaging/public_event.rs
  - apps/desktop/src-tauri/src/messaging/store.rs
  - packages/messaging-core/src/inbox/public_event.rs
referenced-by: []
related:
  - ../../architecture/domains/chat/messaging/design.md
  - ../../architecture/domains/chat/messaging/decisions.md
detected: 2026-10-18
---

# Desktop must consume every Group public lifecycle fact

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

Desktop consumes the lifecycle facts through its existing public-event processor
and atomic receive transaction. It reuses Messaging Core marker/member fact
validation, preserves all member metadata, and checks the exact locally owned
command before committing its intent. A Group with its sole remaining Owner is
a valid active projection.

### What guards against regression

`group_lifecycle_markers_commit_exact_intents_and_preserve_authority_projection`
proves rename, member role/mute, terminal state, exact intent commit and replay.
`conversation_mutation_readback_mismatch_rolls_back_lane_and_local_intent`
proves a contradictory result changes no projection, command, head, receipt or
lane cursor. The Native lifecycle Gate requires receiver-visible rename, role,
Owner transfer, mutation by the new Owner, leave, dissolve and restart history.

## How to detect a recurrence

From `apps/desktop/src-tauri`:

```bash
cargo test --bin peers-touch-desktop --no-default-features --features acceptance-webdriver messaging::public_event::tests --offline
cargo test --bin peers-touch-desktop --no-default-features --features acceptance-webdriver conversation_mutation_readback_mismatch --offline
```

From the repository root, with reviewed remote Profiles and the required reset
authorization:

```bash
python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --station-profile station-four=four --station-profile station-five=fiveArm --gate chat-lifecycle-interactions-group-e2e
```

## Crosswalks

MP-D13 and MP-D14 require ordered Authority facts and the same atomic marker,
projection, cursor and ACK boundary for the sending endpoint and recipients.
