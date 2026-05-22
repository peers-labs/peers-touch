---
kind: pitfall
title: First cut of Tier C1 only fired invalidation on tombstone — BY_HANDLE/INDEXED transitions and profile updates left on slow path
status: active
owns:
  - apps/station/frame/touch/actor/locator_hook.go
  - apps/station/frame/touch/actor/profile.go
  - apps/station/frame/touch/federation/invalidation/
referenced-by:
  - ../invariants/locator-publisher-symmetry.md
related:
  - ../invariants/relay-readloop-discipline.md
  - ../../context/decisions/005-relay-mediated-pubsub-vs-gossipsub.md
detected: 2026-05-18
---

# First cut of Tier C1 only fired invalidation on tombstone

## Symptom

After Tier C1 landed, an operator flipping their actor visibility from PUBLIC → RESTRICTED (or any non-tombstone state change) reported that remote stations kept showing the old visibility for ≥1 cache TTL window — typically minutes. Profile edits (display name, avatar) showed the same staleness on remote screens.

The expected behaviour was the C1 design promise: changes propagate within the relay round-trip (single-digit seconds).

## Root cause

Two compounded omissions on the publisher side:

1. **`PublishVisibility` only broadcast in the tombstone branch.** The function's `switch a.Visibility` had two cases:
   - `BY_HANDLE / INDEXED` → re-`Publish` to DHT, log, return. **No broadcast.**
   - default (HIDDEN/UNSPECIFIED) → `Tombstone` to DHT, log, broadcast `REASON_TOMBSTONE`.

   The author assumed the BY_HANDLE/INDEXED path didn't need a broadcast because "the DHT record is fresh anyway". This conflated the DHT layer (where the locator record lives) with the receiver-side cache layer (which holds the `ActorProfileEnvelope` and goes stale independently of DHT freshness). The envelope is fetched on-demand from the home station; without a push hint, receivers wait for their TTL to expire before re-fetching.

2. **`UpdateProfile` never called the locator hook at all.** Profile changes wrote to `touch_actor` columns but did not call `publishVisibilityAsync`. Therefore `locator_seq` did not advance, the DHT record was not republished, and even the slow path took as long as the receiver's TTL — there was no fast path even in principle.

The fix in 2026-05-18 (commit-pending) closed both:

- Added a Tier C1 broadcast (`REASON_VISIBILITY_FLIP`) at the end of the BY_HANDLE/INDEXED branch.
- Called `publishVisibilityAsync(actor.ID)` from `updateProfileInternal` whenever any field actually changed.

## Mitigation

### What was done in code

- `apps/station/frame/touch/actor/locator_hook.go` — added `PublishVisibilityOption` + `WithoutBroadcast()`; emit `REASON_VISIBILITY_FLIP` broadcast in BY_HANDLE/INDEXED branch by default.
- `apps/station/frame/touch/actor/profile.go` — `updateProfileInternal` triggers `publishVisibilityAsync` when `len(actorUpdates) > 0 || len(metaUpdates) > 0`.
- `apps/station/frame/touch/federation/republisher/republisher.go` — explicitly passes `actor.WithoutBroadcast()` to avoid the inverse failure (broadcast-spam — see `republisher-broadcast-spam.md`).

### What guards against regression

- Invariant `invariants/locator-publisher-symmetry.md` formalises the two-role split (user-driven vs maintenance) so a future callsite that forgets to broadcast becomes a review-blocker, not a silent bug.
- Metric `federation_invalidation_publish_total{result}` now exposes broadcast volume by outcome; a profile-only update path that loses its broadcast wiring will show as a flat-line on the `ok` series under user load.
- Code reviewer rule: any new write path on `touch_actor` must either delegate to `publishVisibilityAsync`, OR explain why no broadcast is appropriate (and pass `WithoutBroadcast()` to make the choice visible).

## How to detect a recurrence

```bash
# 1. Every UpdateXxx that mutates touch_actor columns should reach publishVisibilityAsync.
rg -n 'rds\.Model\(.*\bActor\b\).*Updates\(' apps/station/frame/touch/actor/ --type go

# Each match must be followed (within the same function body) by a call to
# publishVisibilityAsync, or have a comment explaining why no broadcast is
# warranted.

# 2. PublishVisibility's BY_HANDLE/INDEXED branch must end with the broadcast call
# unless WithoutBroadcast was passed.
rg -n -A 8 'case VisibilityByHandle, VisibilityIndexed:' \
  apps/station/frame/touch/actor/locator_hook.go

# Look for `publishInvalidationAsync(...REASON_VISIBILITY_FLIP)` near the bottom
# of the case block, gated on `!o.suppressBroadcast`.
```

Behavioural test (manual, until end-to-end harness exists):

1. Bring up two stations + a relay (`make pt-up ENV=pt-station-1` and `pt-station-2`).
2. On station-1, follow an actor `bob@station-2` so station-1 caches the envelope.
3. On station-2, change `bob`'s display name via `UpdateProfile`.
4. On station-1, expect `federation_invalidation_received_total{reason="REASON_VISIBILITY_FLIP"}` to tick within seconds, and the next read of `bob`'s profile to show the new display name.

If the metric stays flat, the bug regressed.

## Crosswalks

- Invariant `invariants/locator-publisher-symmetry.md` is the formal version of "every callsite must classify itself"; this pitfall is what motivated the formalization.
- Invariant `invariants/relay-readloop-discipline.md` is parallel — the receiver side of the same C1 implementation had the inverse class of bug (handler running synchronously on the read loop). Different surface, same lesson: under-thought async boundaries.
