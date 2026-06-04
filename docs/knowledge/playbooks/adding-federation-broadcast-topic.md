---
kind: playbook
title: Adding a new federation broadcast topic (relay-mediated pub/sub)
status: active
owns:
  - apps/station/frame/core/plugin/native/subserver/relay/
  - apps/station/frame/touch/federation/
referenced-by: []
related:
  - ../invariants/relay-readloop-discipline.md
  - ../invariants/locator-publisher-symmetry.md
  - ../../context/decisions/005-relay-mediated-pubsub-vs-gossipsub.md
detected: 2026-05-18
---

# Adding a new federation broadcast topic (relay-mediated pub/sub)

## When to use

Use this playbook when introducing a NEW relay-mediated pub/sub topic alongside the existing `fed.invalidate.v1`. Triggers:

- A new federation event needs to fan out from one station to all peer stations on the same relay (e.g. block-list propagation, presence summary, federated config push).
- Adding a new `Reason` to an EXISTING topic does NOT trigger this playbook; that's a proto extension, not a new transport.

This playbook does NOT cover relay-to-relay traversal (multi-relay topology) — that's a separate, deferred concern.

## Pre-conditions

- [ ] Tier C1 (`fed.invalidate.v1`) is shipped and you've read its end-to-end implementation as the reference.
- [ ] You understand the two-role split for any local publisher (see invariant `locator-publisher-symmetry`).
- [ ] You've decided on the topic's *trust model*: who can publish, who is the authority, what is the relay's role in stamping fields.
- [ ] You've decided on the topic's *cardinality envelope*: max events/sec across all publishers, max payload size; both must respect `protocol.MaxBroadcastBodyLen` (64KB) and `MaxBroadcastTopicLen` (128B).
- [ ] If the event references actor identity, the proto carries `federated_handle` + `home_station_peer_id` (NOT actor IDs — those are station-local).

## Steps

### 1. Define the wire format (proto-first)

- Add `model/domain/federation/<topic>.proto` with one top-level message.
- Carry an `origin_peer_id` field (`string` at field number 4 by convention) that publishers MUST leave empty — the relay stamps it. State this explicitly in a `// ` comment on the field.
- Carry a `issued_at_unix_ms` field for replay detection at receivers.
- Run `./model/build.sh` to generate Go bindings.

Avoid:

- Putting raw actor IDs in the proto. Use `federated_handle` so the message is meaningful across stations.
- Adding fields the receiver can't independently verify (free-form bools that mean "trust me").

### 2. Pick the topic identifier

Convention: `fed.<verb-or-noun>.v1`. The version suffix is non-negotiable — when you change the proto in a backward-incompatible way, you bump to `v2` and run both for the migration window.

Add the topic constant to the package that owns the receiver-side handler (mirrors `invalidation.Topic = "fed.invalidate.v1"`).

### 3. Allow-list the topic on relay startup

Open `apps/station/frame/core/plugin/native/subserver/relay/relay.go` `Start()`:

```go
s.streams.SetAllowedBroadcastTopics(
    broadcastTopicFedInvalidate,
    broadcastTopicYourNewTopic,  // append here
)
```

The allow-list is deny-by-default. A new topic that isn't allow-listed will be silently dropped at the relay with a warn log — useful in dev, fatal at shipping.

### 4. Wire the receiver-side handler

Create a sibling package `apps/station/frame/touch/federation/<your-feature>/`:

- `<feature>.go` — exports `Subscribe()` that calls `federation.RegisterBroadcastHandler(handle)`.
- `metrics.go` — defines counters mirroring the C1 pattern:
  - `federation_<feature>_received_total{<axis>}`
  - `federation_<feature>_dropped_total{cause}`
  - `federation_<feature>_applied_total{<axis>}`
  - `federation_<feature>_publish_total{result}`
  - Use bounded `const` label values; never inline string literals at metric callsites.

The handler's structure MUST be:

```go
func handle(ctx context.Context, originPeerID, topic string, body []byte) {
    if topic != Topic {
        // Different topic on the same callback registry slot — count and drop.
        metDropped.Inc(dropCauseUnrelatedTopic)
        return
    }
    ev, err := Decode(body)
    if err != nil { ... metDropped.Inc(dropCauseDecodeError); return }

    metReceived.Inc(<axis>)

    // Trust gate(s) — drop with a labelled cause for each.

    // Apply — happy path. metApplied.Inc(<axis>) on success.
}
```

Trust gates (apply ALL applicable):

1. **Origin authority** — cross-check `originPeerID` against whatever the data says is the rightful publisher (cached row's `home_station_peer_id`, ACL list, etc.). On mismatch: `metDropped.Inc(dropCauseOriginMismatch)`, drop.
2. **Replay protection** — compare an event sequence number with what's already cached. Drop on stale; equal is allowed if your apply step is idempotent.
3. **Local relevance** — if the receiver has no state to update (e.g. cache miss for an invalidation), drop with a labelled cause; this is normal and high-volume.

### 5. Subscribe at boot

Add `<feature>.Subscribe()` to the appropriate composition root. For federation features the established slot is `apps/station/frame/core/plugin/native/subserver/bootstrap/bootstrap.go::Start()`, alongside `invalidation.Subscribe()`.

### 6. Wire the publisher (typed helpers, not raw counters)

In the same `<feature>` package, expose typed helpers for the publish path:

```go
func RecordPublishOK()                  { metPublish.Inc(publishResultOK) }
func RecordPublishEncodeError()         { metPublish.Inc(publishResultEncodeError) }
func RecordPublishRelayNotConnected()   { metPublish.Inc(publishResultRelayNotConn) }
func RecordPublishError()               { metPublish.Inc(publishResultPublishError) }
```

The publishing site (typically a domain hook) calls these helpers. NEVER let the hook reach into `metPublish` directly — the typed helpers are the audit trail for which label values are valid.

### 7. Apply the readLoop discipline (BOTH SIDES)

Re-read invariant `invariants/relay-readloop-discipline.md`. Specifically:

- The **receiver-side** handler in step 4 will be invoked from `relay-client/relay_client.go` readLoop. The dispatch is already done with `go c.cfg.BroadcastHandler(...)`, so your handler may perform DB I/O — but only ONE handler runs per inbound frame; do not block on locks held by sibling handlers.
- The **relay-side** fan-out path is already non-blocking (per-sibling write spawned on its own goroutine). You are not adding code here.

If your feature requires the publisher's `Publish` call to be synchronous-but-bounded: use the existing `publishInvalidationAsync` pattern (`context.WithTimeout(5 * time.Second)`) — never let a publisher hold an HTTP handler goroutine while waiting on a relay write.

### 8. Apply the publisher-symmetry discipline (if `PublishVisibility` is involved)

If your new event fires from `PublishVisibility` or any of its callers, re-read invariant `invariants/locator-publisher-symmetry.md`. Decide for every NEW callsite whether it is user-driven or maintenance, and pass `WithoutBroadcast()` for the maintenance case.

If your event fires from a NEW domain hook unrelated to `PublishVisibility`, document the user-driven / maintenance split in your hook's doc-comment so the same audit trail exists.

### 9. Tests

Mandatory:

- Round-trip codec test for the new proto (`Encode` / `Decode`) — both happy path and oversized-body rejection.
- Topic allow-list test — add a `t.Run` to the existing relay broadcast suite that exercises the new topic and confirms an off-policy variant is dropped.

Recommended:

- Trust-gate table test for the receiver handler (`origin mismatch`, `stale seq`, `cache miss`, `decode error` → expected drop label).
- End-to-end harness if and only if the existing C1 path has one (it does not, as of 2026-05-18 — same constraint applies to your feature).

### 10. Documentation

- Add the new topic + reason values to `docs/knowledge/glossary.md` under "Push-style invalidation (Tier C1)" or a sibling section.
- If the trust model changes (new authority, new gate), add an invariant to `docs/knowledge/invariants/`.
- Update `.localenv` with a brief section under "Tier C..." capturing the choice.

## Verification

- [ ] `./model/build.sh` succeeds and the generated `.pb.go` compiles.
- [ ] `go vet ./apps/station/...` clean.
- [ ] `go test -race -count=1 ./apps/station/frame/core/plugin/native/subserver/relay/... ./apps/station/frame/touch/federation/<feature>/...` clean.
- [ ] `gofmt -l` shows zero output for the touched files.
- [ ] All four metric families (`received`, `dropped`, `applied`, `publish`) appear in `/metrics` after a single test publish.
- [ ] Manual two-station test: a publish on station A produces a metric tick on station B (or a labelled drop) within one heartbeat window.
- [ ] No new entry in `pitfalls/` (i.e. nothing went wrong that wasn't already documented).

## Crosswalks

- Invariants automatically respected if you follow this playbook:
  - `invariants/relay-readloop-discipline.md`
  - `invariants/locator-publisher-symmetry.md` (when applicable)
- Pitfalls actively avoided:
  - `pitfalls/c1-tombstone-only-broadcast.md` — by step 8.
  - `pitfalls/republisher-broadcast-spam.md` — by step 8.
- Decision context:
  - `docs/context/decisions/005-relay-mediated-pubsub-vs-gossipsub.md` — explains why this transport exists.
