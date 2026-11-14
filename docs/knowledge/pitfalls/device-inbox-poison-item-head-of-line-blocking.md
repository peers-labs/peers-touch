---
kind: pitfall
title: One poison inbox item must not head-of-line-block the whole device lane
status: active
owns:
  - packages/messaging-core/src/inbox/drain.rs
  - packages/messaging-core/src/inbox/quarantine.rs
  - packages/messaging-core/src/inbox/consumer.rs
  - packages/messaging-core/src/inbox/conversation_state.rs
  - packages/messaging-core/src/inbox/direct.rs
  - packages/messaging-core/src/contracts/mod.rs
  - packages/messaging-core/src/store/repository.rs
  - packages/messaging-core/src/store/schema.rs
  - apps/desktop/src-tauri/src/messaging/store.rs
  - apps/desktop/src-tauri/src/messaging/engine.rs
  - apps/mobile/src-tauri/src/messaging/adapter.rs
  - apps/mobile/src-tauri/src/messaging/engine.rs
  - model/domain/chat/receipt.proto
related:
  - docs/knowledge/pitfalls/desktop-group-public-event-consumption.md
  - apps/station/app/subserver/conversation/infrastructure/delivery/repository.go
detected: 2026-11-06
---

# One poison inbox item must not head-of-line-block the whole device lane

## Symptom

On corpstable, pressing Enter in a Direct chat froze for up to the 15s
command-plan convergence deadline, then messages sat in `Queued`
("Delivery unconfirmed, background retries continue"). The recipient device
lane was parked at `acked_through=91` while items 92/93 stayed claimed:
item 92 was retried 2175 times with the same deterministic validation error
(`messaging Direct conversation membership projection is invalid`) and item
93 — a different conversation — could never be delivered behind it. Sender
latency and every other conversation on that device were coupled to one
invalid item.

## Root cause

Three independent facts combined:

1. **Two layers enforced the same genesis invariant with different
   strictness.** Station legitimately enqueues a one-member self-direct
   (`SelfDirectConversationID`, Saved Messages) `ConversationState` event.
   `verify_direct_genesis_event` in messaging-core rejected anything that was
   not a two-member Direct, and Desktop's `validate_conversation_projection`
   repeated the same rule, so a well-formed self-direct genesis that the
   authority Station had accepted failed forever on the receiver.
2. **The device queue is a contiguous ack lane.** Station Claim only returns
   items beginning at `acked_through + 1` and Acknowledge accepts only the
   exact claimed head; `QueueDrain` stopped on the first consumer error.
   Deterministic content failures therefore retried indefinitely and blocked
   every later item, including healthy conversations.
3. **The send IPC ran convergence work inline.** `submit_message` called
   `prepare_converged_command_plan`, which drains the inbound lane before the
   Station prepare HTTP call, so Enter blocked on unrelated inbox poison for
   the full `COMMAND_PLAN_CONVERGENCE_TIMEOUT`.

Station's own `Reject`/`DEAD_LETTER` path does NOT unblock delivery:
`TestRetryDeadLetterAndHeadBlocking` pins that a dead-letter head stays in
front of later items (fail-closed quarantine awaiting attention). Treating a
client-side reject as a cure is therefore wrong; the client must quarantine
locally and use the ordinary ack.

## Mitigation

- Self-direct is a first-class Direct shape: one member that is also the owner
  and receiver, Local scope, with its endpoint set; both messaging-core
  verification and Desktop projection validation accept it (`verify_direct_genesis_event`,
  `validate_conversation_projection`).
- Inbox consumption failures are typed (`ConsumeError` in `inbox/drain.rs`):
  - deterministic content failures (`PayloadInvalid` / `IntegrityFailed` /
    `RecipientMismatch`) are permanent for the item bytes;
  - storage, missing crypto state, prekey and ratchet-decrypt failures stay
    retryable (default; every unclassified `String` maps to retry).
- `QuarantiningConsumer` decorates the dispatcher on Desktop and Mobile:
  before a permanent error is returned it durably records the raw item plus a
  `DeviceRejectedItemReceipt` in `messaging_rejected_items`, writes the
  consumption marker and advances the lane cursor — without touching the
  authority hash chain or creating a projection. `QueueDrain` then acks the
  quarantined item with the normal Station ack and continues the batch, so a
  poison conversation cannot stall other conversations. If the quarantine
  commit fails, the error degrades to retryable and the item is not acked.
  Every processor classifies its own deterministic gates: Direct and
  ConversationState down to binding/marker/session-shape sites, receipts,
  service-plaintext and public events at their envelope, kind and reserved
  endpoint gates, while MLS processing stays retryable because group state
  and commit ordering can change.
- Store layers declare deterministic semantic rejection through the
  `[messaging-item-rejected:CODE]` marker (`mark_item_rejection`), decoded by
  `classify_reception_error`, instead of widening every repository method to
  a typed enum.
- Submit is admission-only: `submit_message` only makes the draft durable and
  returns `state: "draft"`; plan resolution, crypto preparation and inbound
  drain run in `resume_message_draft_once` on the lifecycle worker, which the
  caller wakes immediately after admission. The renderer already treats
  `draft` as an admitted durable message (MP-D33).

### What guards against regression

- `permanent_rejection_is_acked_and_never_blocks_later_items` and
  `store_rejection_marker_classifies_as_permanent_only_when_well_formed` in
  `packages/messaging-core/src/inbox/drain.rs`.
- `rejected_endpoint_payload_advances_lane_without_authority_chain_or_projection`
  in Desktop's `store.rs`: rejection ledger, marker and cursor advance
  atomically, the authority chain is untouched, replay is idempotent and the
  next lane item from another conversation commits.
- `self_direct_conversation_projection_accepts_singleton_owner_member` and
  `self_direct_genesis_verifies_singleton_member_shape` cover the self-direct
  shape; non-owner singleton members still fail closed with the rejection
  marker.
- Draft admission tests (`draft`, `submit`, `send_intent` filters) cover the
  decoupled send path.

## How to detect a recurrence

```bash
cargo test --manifest-path packages/messaging-core/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop -- \
  rejected self_direct drain draft submit send_intent
```

Observationally: Station `device_queue_lanes.acked_through` must keep
advancing when a failing item is deterministic, while
`messaging_rejected_items` grows locally; a healthy Enter returns
immediately with `state: "draft"` and the lifecycle worker finishes
preparation asynchronously.

## Crosswalks

- The unknown-payload-kind skip+ack mechanism (G-BOT-10,
  `SkippedPayloadProcessor`) established the client-side pattern this fix
  generalizes from "future wire kind" to "deterministically invalid item".
- MP-D13/MP-D14 define the contiguous marker/projection/cursor/ACK boundary;
  quarantine commits the same boundary minus the authority chain, because an
  invalid event must never become an authority fact.
- MP-D33 defines the durable-admission draft contract that lets submit stop
  performing Station/drain work inline.
