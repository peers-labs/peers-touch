---
kind: pitfall
title: Actor Home and parent Home may be the same Station
status: active
owns:
  - apps/station/app/subserver/social/application/feed_federation.go
  - apps/station/app/subserver/social/application/feed_federation_test.go
related:
  - ../../architecture/domains/social/federation/interaction-completion.md
referenced-by: []
detected: 2026-11-08
---

# Public interaction fanout uses the parent Home role

The original receiver rejected a frame whenever its source equalled the Actor
Home and its parent Home differed from the receiver. A reproduced signed
receipt from an author interacting at their own Home was therefore rejected
when that Home fanned it out to a subscribing Station: both Home roles were
the same source.

Direct voter forwarding requires the parent Home as receiver only when the
Actor Home differs from the parent Home. A source that equals the parent Home
is eligible to perform the original author fanout. Signature, Actor root,
device, stable target and original public projection checks remain required.
An absent parent retains the original deferred receipt, without proving a
visible projection or completed product interaction.

## How to detect a recurrence

Run `go test ./subserver/social/application -run
TestFeedAuthorHomeFanoutIsNotMistakenForDirectVoterForwarding -count=1` from
`apps/station/app`. The actual receiver must retain the authentic receipt.
Native receiver rendering is a separate required Journey assertion.
