---
kind: invariant
title: Device Inbox epoch observation preserves attempt fencing
status: active
owns:
  - apps/station/app/subserver/conversation/infrastructure/delivery/
  - packages/messaging-core/src/inbox/
related:
  - docs/architecture/domains/chat/messaging/design.md
  - docs/architecture/domains/chat/messaging/decisions.md
detected: 2026-10-25
---

# Device Inbox epoch observation preserves attempt fencing

## What must hold

A committed Claim may lose its HTTP response. When a lower nonzero expected
epoch belongs to the lane's still-active consumer ID, Claim returns only current
lane metadata after checking that the cursor does not skip the unacknowledged
head. It returns no items and changes no lane, payload, lease, attempt, or ACK.
This remains true after lease expiry.

The existing client epoch observer adopts that response. A subsequent eligible
Claim creates a new attempt and advances the epoch. Future expected epochs,
superseded consumer IDs, and old-attempt ACK/Reject remain fenced. A client must
not clear its expected epoch to bypass a consumer-fenced error.

## Why

Strict rejection of every epoch mismatch permanently strands a running consumer
after a lost committed reply. Replaying its live payload or reusing the old
epoch instead would allow delayed outcomes to mutate a later attempt.
Read-only observation recovers the client without transferring ownership.

## How to verify

From `apps/station/app`:

```bash
go test ./subserver/conversation/infrastructure/delivery \
  -run 'TestClaim(RecoversCommittedLostResponseWithoutReplayingLease|MetadataRecoveryPreservesConsumerAndHeadFences)$' \
  -count=1 -timeout=30s
```

The real Repository/Service/protobuf HTTP regression aborts a response after
commit, observes network EOF, compares persisted lane and item before/after
metadata recovery, waits through controlled lease expiry, and verifies a newly
fenced attempt can ACK the exact head. The companion regression rejects a
different consumer, future epoch, skipped head, and superseded consumer.

These source checks do not replace current-source native receiver-visible
Messaging and Search Journeys.
