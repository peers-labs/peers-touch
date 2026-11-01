---
kind: invariant
title: Self-direct is a one-member Direct, never a new kind
status: active
owns:
  - apps/station/app/subserver/conversation/domain/valueobject/value_objects.go
  - apps/station/app/subserver/conversation/domain/aggregate/conversation.go
  - apps/station/app/subserver/conversation/application/command/service.go
  - apps/station/app/subserver/conversation/production_http.go
  - apps/station/app/subserver/conversation/gate_evaluator.go
  - packages/messaging-core/src/outbox/send.rs
  - apps/desktop/src/store/socialChat.ts
  - apps/desktop/src/store/socialProjection.ts
  - apps/desktop/src/components/chat/ChatContactsPanel.tsx
referenced-by: []
related:
  - docs/architecture/domains/chat/lifecycle/self-direct.md
detected: 2026-10-31
owner: Client Platform / Conversation domain
review-cadence: annual
next-review: 2027-10-31
---

# Self-direct is a one-member Direct, never a new kind

## What must hold

"Self-direct" (Saved Messages / 给自己发消息) MUST be modelled as a `DIRECT`
Conversation with exactly one active member — the creator. It MUST NOT gain a
dedicated conversation kind, a local-only notes store, or a parallel command,
delivery, crypto, sync, projection, search, or attachment pipeline.

Deterministic identity is dispatched through
`valueobject.DirectConversationIDForActors(left, right)`: equal actors resolve
to `SelfDirectConversationID` (`direct-self-<sha256(ptid)[:16]>`), distinct
actors to the pair helper. No caller MAY special-case equal actors outside
that dispatcher. Scope is always Local; the gate allows target == subject
without relationship checks and rejects federation.

On the client crypto side, a send plan whose sole required endpoint is the
local device is valid (public-event-only command, zero ciphertext
payloads); every additional required endpoint MUST still resolve a pairwise
Direct session. Desktop renders the singleton Direct without peer chrome:
no presence dot, no calls, no safety-number section, no peer profile fetch;
title/avatar come from the authenticated profile with the localised
"savedMessages" fallback via `directConversationDisplayName`.

## Why this is non-negotiable

A fourth conversation shape forks every messaging pipeline: command receipts,
delivery-kind mapping, MLS/direct crypto bootstrap, multi-device sync, inbox
projection, full-text search and attachment ownership would each need a
feature-parallel implementation kept in sync forever — a second chimney.

The existing rules already generalise exactly: the server derives one
`public_event` for the sender endpoint and pairwise `direct_ciphertext` for
every other required endpoint, including the sender's own other devices;
read cursors already exclude the sender so self messages are never unread.
Introducing separate identity or delivery code for "self" would also break
idempotent replay, because a retry of the first creation must land on the
same deterministic Conversation through the same `EnsureDirect` path.

A parallel identity scheme (e.g. reusing the pair hash of (ptid, ptid), or a
client-generated local id) would collide with the distinct-actor invariant
of `DirectConversationID`, desynchronise multi-device clients, and make
federation ambiguity possible. Federation MUST never carry a self-direct.

## How to verify

- `rg -n "SELF_DIRECT|SELF_DIRECT_MESSAGE|ConversationKind_SELF" model/domain apps packages` — must return zero hits.
- `rg -n "DirectConversationID\\(" apps/station/app --glob '*.go'` — every remaining call site passes two semantically distinct actors (system-direct, accepted-relationship, publishing); equal-actor creation must go through `DirectConversationIDForActors`.
- `go test ./subserver/conversation/...` from `apps/station/app` — covers singleton genesis, 1/2/0/3 invariant matrix, replay idempotency, delivery-set equality and the federation rejection.
- `cargo test --lib` from `packages/messaging-core` — `self_direct_single_device_sends_public_event_without_ciphertext` must pass.
- Desktop `pnpm exec vitest run src/store/socialChat.conversationProjection.test.ts` — singleton member set yields `selfDirect: true`; a two-member Direct yields `false`.

## Crosswalks

- Design contract: `docs/architecture/domains/chat/lifecycle/self-direct.md`.
- Direct session topology: `docs/architecture/domains/chat/messaging/decisions.md` MP-D06 (Direct session per endpoint pair).
