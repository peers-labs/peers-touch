---
kind: invariant
title: Every PublishVisibility caller is either user-driven or maintenance — no third category
status: active
owns:
  - apps/station/frame/touch/actor/locator_hook.go
  - apps/station/frame/touch/actor/profile.go
  - apps/station/frame/touch/actor/federation_self.go
  - apps/station/frame/touch/actor/account.go
  - apps/station/frame/touch/federation/republisher/
  - apps/station/frame/core/plugin/native/subserver/bootstrap/handler.go
referenced-by:
  - ../pitfalls/republisher-broadcast-spam.md
  - ../pitfalls/c1-tombstone-only-broadcast.md
  - ../playbooks/adding-federation-broadcast-topic.md
related:
  - ../../architecture/domains/identity/unified-actor-system.md
  - ../../architecture/domains/identity/federation-catalog.md
detected: 2026-05-18
---

# Every PublishVisibility caller is either user-driven or maintenance — no third category

## What must hold

Every callsite of `actor.PublishVisibility(ctx, actorID, opts...)` MUST classify itself into exactly one of two roles:

- **User-driven** — the actor's content or visibility actually changed. Caller passes no `WithoutBroadcast` option; the function emits a Tier C1 invalidation broadcast on success. Examples: `SignUp`, `UpdateVisibility`, `UpdateProfile`, the operator-triggered `bootstrap.locatorPublish` HTTP endpoint.
- **Maintenance** — the row is republished only to keep the DHT entry from expiring; the envelope content is byte-identical to the previous round. Caller passes `actor.WithoutBroadcast()`; no broadcast is emitted. Today the sole maintenance caller is `federation/republisher/republisher.go`.

A "third category" — fire `PublishVisibility` for some other reason and leave the broadcast decision to chance — is forbidden. New callsites must either prove they belong to one of the two roles or update this invariant before merging.

## Why this is non-negotiable

The two failure modes are asymmetric and both are real:

**If a user-driven caller forgets to broadcast** (or uses `WithoutBroadcast`), receivers' caches stay stale until the per-row TTL expires (default minutes-to-hours). Tier C1's entire reason for existing is to make that propagation latency seconds, not minutes. A user flips visibility to private, the slow path eventually catches up — but the user has already seen their post on someone else's screen for 30 seconds, which is the privacy regression the tier was designed to eliminate.

**If a maintenance caller broadcasts**, the relay channel is flooded by traffic with no semantic meaning. The republisher loops over every local INDEXED/BY_HANDLE actor at `Republisher.Interval` (default 30 min). With N local actors and M peer stations on the relay, naive broadcast-on-every-republish produces `N × M / Interval` broadcasts that propagate to every peer. The receivers gate via the trust check (`event.locator_seq < cached.locator_seq` → drop), so semantics survive — but each event is decoded, hashed, and accounted for in metrics, and the relay's fan-out goroutines are scheduled for nothing. With 100 local actors and 4 peers, that's 800 fan-outs per loop on every station, every half hour. Pure noise; obscures real signal in metrics; consumes bandwidth that the user paid for to host federation.

The two-role split with explicit opt-out is the smallest surface that makes the choice visible at every callsite. A `bool` parameter would have been ambiguous (true = which?); a separate function would have duplicated the body. Functional options keep the API stable AND force the maintenance caller to type `WithoutBroadcast()` — the typing is the audit trail.

## How to verify

Static check — every callsite must be greppable and obviously categorized:

```bash
rg -n 'PublishVisibility\(' apps/station/ --type go
```

Each match must be one of:

| Callsite pattern | Role | Required form |
|------------------|------|---------------|
| `publishVisibilityAsync(actorID)` | user-driven (delegates) | NO `WithoutBroadcast` |
| `actor.PublishVisibility(ctx, id)` from `republisher/` | **MUST** be maintenance | `WithoutBroadcast()` |
| `actor.PublishVisibility(ctx, id)` from `bootstrap/handler.go` | user-driven (operator) | NO `WithoutBroadcast` |
| `actor.PublishVisibility(ctx, id, ...)` from anywhere else | new code | classify and pass option explicitly |

Reviewer rule: any `PublishVisibility` call where the role is not obvious from the surrounding 5 lines is a review block.

Metric guard:

- `federation_invalidation_publish_total{result="ok"}` should track user-driven request rate, NOT republisher rate. If the counter rises in lockstep with `Republisher.Interval` (visible as a per-30min step), the invariant is being violated by a recently added callsite — bisect by callsite using request logs.

## Crosswalks

- Pitfall `pitfalls/republisher-broadcast-spam.md` is the fictional-but-narrowly-avoided failure of this invariant during Tier C1's first cut.
- Pitfall `pitfalls/c1-tombstone-only-broadcast.md` documents the inverse failure: user-driven callers (specifically `UpdateProfile` and the BY_HANDLE/INDEXED branch of `PublishVisibility`) didn't broadcast at all.
- Playbook `playbooks/adding-federation-broadcast-topic.md` shows the correct way to wire a new write path that needs broadcast.
