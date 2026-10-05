# AO-D07 Owner Decision

> **Status**: pending-owner-acceptance
> **Version**: v1.0
> **Created**: 2026-09-07 | **Updated**: 2026-09-07
> **Owner**: Architecture Team

---

## Decision Needed

Approve or reject `AO-D07` as one architecture package.

Recommended decision:

```text
APPROVE AO-D07
```

Independent architecture review found zero P0/P1 blockers after four correction
rounds.

## Why This Exists

CA-W5 reached production composition and proved that six generated contracts
cannot carry the semantics already required by the accepted Conversation DDD,
Social authority, Key Exchange, and shared Federation implementation.

Continuing without this amendment would require one or more forbidden shortcuts:

- server-generated retry identity;
- Home Station actor-signature forgery;
- two committed Conversation event models;
- unsigned Friend Request decisions;
- destructive one-time-key fetch without exact replay;
- non-durable remote DKX.

## What Approval Means

1. **Direct creation**
   - The device signs one caller-owned creation command.
   - Accepted Social relationship proves actor and immutable v1 Home facts only.
   - Conversation alone derives and persists the deterministic Direct authority.
   - Opposite-Home concurrent creation converges on one Direct ID and one authority.

2. **Group creation**
   - Group prepare remains hidden and non-authoritative.
   - Commit submits one exact canonical `ChatCommand`.
   - The command must match the plan requester, endpoint set, reservations,
     epochs, Commit, and Welcome payloads before one atomic genesis commit.

3. **Conversation commands**
   - Local authority accepts an authenticated raw `ChatCommand`.
   - Remote authority requires the existing D-17 actor-device-signed proposal.
   - Remote proposal/result delivery uses the shared durable Federation frame.
   - Lost results recover through command-result readback.

4. **Conversation events**
   - `ConversationEvent` is the only committed event for results, history,
     follower sync, persistence, and Device Inbox delivery.
   - `CommittedConversationEvent` is deleted, not translated indefinitely.

5. **Friend Request**
   - Send, accept, and reject carry an actor-device-signed
     `FriendRequestCommand`.
   - HTTP success distinguishes Home durable admission from receiver-authority
     resolution.
   - Same-Station and cross-Station requests use the same durable receiver path.
   - Social triggers Direct creation only after accepted relationship convergence.

6. **Destructive key-material fetch**
   - Direct bundle and plain MLS fetch use caller-owned request IDs.
   - Exact retries return the same consumed material while the response receipt
     is retained.
   - Later tombstones prevent a retry from consuming new one-time material.

7. **DKX**
   - Remote DKX uses one typed shared Federation payload.
   - The target Home Station returns a signed proof for the exact Device Inbox row.
   - A new Direct session generation cannot send dependent ciphertext without
     that proof.

## What Approval Does Not Mean

- It does not create another Chat or Messaging API.
- It does not restore any `/messaging/*` route.
- It does not allow aliases, dual writes, fallback reads, or compatibility types.
- It does not make Social the Conversation authority.
- It does not make Federation a business-truth owner.
- It does not claim CA-W5, PostgreSQL contention, two-Station runtime, or Windows
  Acceptance complete.
- It does not authorize a version bump or push.

## Cost

- CA-W1 proto and generated bindings must change again.
- Desktop, Mobile, Station, Messaging Core, Social, Key Exchange, Federation, and
  Acceptance callers must move atomically.
- The uncommitted CA-W5 diff grows before it can shrink through old-path deletion.

This cost is already inside CA-W5 scope. Rejecting AO-D07 requires a different
architecture that still satisfies the same authority, signature, idempotency,
one-time-key, and hard-cut invariants.

## After Approval

Execution resumes without another architecture stop:

```text
proto amendment
  -> regenerate all bindings
  -> finish Station production composition
  -> migrate Desktop/Mobile/Acceptance consumers
  -> delete superseded routes, types, stores, and owners
  -> run CA-W5 gates
  -> commit without push
```

## Detailed Evidence

- Full contract:
  [`20260907-ca-w5-canonical-wire-contract-amendment.md`](./20260907-ca-w5-canonical-wire-contract-amendment.md)
- Review checklist:
  [`20260907-ca-w5-canonical-wire-contract-review-prompt.md`](./20260907-ca-w5-canonical-wire-contract-review-prompt.md)
- Governing decision:
  [`../decisions.md`](../decisions.md)
- Active execution plan:
  [`../execution-plans/20260906-conversation-authority-hard-cut.md`](../execution-plans/20260906-conversation-authority-hard-cut.md)
