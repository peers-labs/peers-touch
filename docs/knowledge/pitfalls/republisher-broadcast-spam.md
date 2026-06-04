---
kind: pitfall
title: Naive "broadcast on every PublishVisibility success" turns periodic republisher into a relay traffic generator
status: active
owns:
  - apps/station/frame/touch/federation/republisher/
  - apps/station/frame/touch/actor/locator_hook.go
referenced-by:
  - ../invariants/locator-publisher-symmetry.md
related:
  - ../invariants/relay-readloop-discipline.md
detected: 2026-05-18
---

# Naive "broadcast on every PublishVisibility success" turns periodic republisher into a relay traffic generator

## Symptom

Caught at design-review time, BEFORE shipping — but worth recording because the failure mode is non-obvious and a future contributor is likely to re-introduce the same pattern.

If the BY_HANDLE/INDEXED branch of `PublishVisibility` had been wired to fire a Tier C1 invalidation broadcast UNCONDITIONALLY (as the first instinct suggests when closing the original tombstone-only gap — see `pitfalls/c1-tombstone-only-broadcast.md`), the periodic `federation/republisher` loop would have produced steady-state broadcast traffic with no semantic content:

- Republisher interval: default 30 minutes.
- Republisher scans `WHERE origin = 'local' AND visibility IN (BY_HANDLE, INDEXED)` and calls `PublishVisibility` for every matching row.
- Without an opt-out, every row → one DHT republish + one relay broadcast.
- Relay then fans the broadcast to every other connected station.

For N local actors and M peer stations, that's `N × (M - 1)` broadcast deliveries per republisher tick, on every station. For a 10-actor station with 4 peers, ~30 deliveries every 30 minutes, all of which the receivers would correctly drop in the trust gate (`event.locator_seq < cached.locator_seq` would be false because the seq did bump, but the cached envelope is still valid — the receiver would re-fetch it for nothing).

Receivers' caches would keep getting evicted-and-refetched on each republisher tick, even though nothing changed. The work scales with population × topology with no upper bound.

## Root cause

Two distinct events collapse into the same call to `PublishVisibility`:

1. **Content / visibility actually changed** (user-driven). Receivers' caches ARE stale; broadcast invalidation is the entire point of Tier C1.
2. **Periodic refresh to keep DHT entries from expiring** (maintenance). The envelope is byte-identical to last round; receivers' caches are correctly populated; broadcasting is pure noise.

The function's signature and body cannot tell the two apart from inside — the row state at the moment of the call is identical. The choice has to come from the **caller**, not from runtime introspection.

The temptation to "just broadcast every time" is strong because it sounds conservative ("better safe than sorry — receivers will gate it anyway"). But the cost is asymmetric: the broadcast is cheap on the publisher and on each receiver, but it scales with `N × M / Interval` and is paid every interval, forever. There's no equilibrium where it's free.

## Mitigation

### What was done in code

- `apps/station/frame/touch/actor/locator_hook.go` — `PublishVisibility` accepts `PublishVisibilityOption` variadic; default behaviour is to broadcast on success in the BY_HANDLE/INDEXED branch.
- Same file — exposed `WithoutBroadcast()` option that suppresses the broadcast.
- `apps/station/frame/touch/federation/republisher/republisher.go` — `runOnce` passes `touchactor.WithoutBroadcast()` on every iteration.

### What guards against regression

- Invariant `invariants/locator-publisher-symmetry.md` — every callsite must self-classify.
- Reviewer rule: any new caller of `PublishVisibility` from a periodic / scheduled / hook context (cron, after-write trigger, lifecycle phase) must demonstrate it is user-driven OR pass `WithoutBroadcast()`. The default is "user-driven" specifically so the *quiet* case requires explicit typing — making the maintenance role visible at every callsite.

## How to detect a recurrence

```bash
# Every periodic / loop / trigger callsite must carry WithoutBroadcast().
# This grep returns a hit if any caller in republisher / scheduler / cron-style
# code is missing the opt-out.
rg -n -B 2 -A 4 'PublishVisibility\(' \
  apps/station/frame/touch/federation/republisher/ \
  apps/station/frame/touch/federation/scheduler/ 2>/dev/null

# Each hit's context must include `actor.WithoutBroadcast()` on the same call.
# If a periodic caller doesn't pass it, you're staring at the regression.
```

Metric guard:

- `federation_invalidation_publish_total{result="ok"}` is the canonical signal. Plotted over time, this counter should track *user request rate*, not the republisher cadence. If you see step-function increases at every `Republisher.Interval`, the regression has happened — bisect by callsite using request logs.

- A secondary tell: `federation_invalidation_dropped_total{cause="stale_seq"}` would NOT spike, because the receiver side's gate accepts equal seqs. The bug is invisible to the receiver-side metrics; it only shows up on the publisher side.

## Crosswalks

- Invariant `invariants/locator-publisher-symmetry.md` is the formal version of the rule this pitfall protects.
- Pitfall `pitfalls/c1-tombstone-only-broadcast.md` documents the *opposite* failure (user-driven path missing broadcast); the two together define the boundary of the invariant.
