---
kind: pitfall
title: Actor Home and parent Home may be the same Station
status: active
owns:
  - apps/station/app/subserver/social/application/feed_federation.go
  - apps/station/app/subserver/social/application/feed_federation_test.go
  - apps/station/app/subserver/social/application/feed_reader.go
  - apps/station/app/subserver/social/application/feed_log_service_test.go
  - tooling/acceptance/gates/social/public_feed_native.py
  - tooling/acceptance/gates/social/test_public_feed_native.py
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

The lost-Federation-hint scenario must retain each original validated notification
sample as the bounded last observation before its rule is retired. Otherwise a
repair timeout loses the distinction between no matching dropped hint and an
actual lost hint with no causal repair. The original 80-second shared budget,
minimum author head, authenticated frame digest and verified repair conditions
remain unchanged. Receiver read observation and Native rendering capture are
independent attempts on timeout and must preserve the first exception.
Observe both original import paths: subscription repair and `ReadForViewer`.
The Native Runtime may import the lost head through its bounded authenticated
read before the worker's next pull sees zero events. The foreground callback
belongs after original signature, head and thread verification and must report
the local verified prefix, not an advertised unimported tail. Run the original
`TestFeedExplicitReadRetainsBoundedPrefixAndRechecksExposure` regression: valid
imports are observed, continuations retain the actual prefix, already-seen heads
have zero events, and invalid, oversized or offline pulls cannot claim repair.
The original control still rejects pre-loss, zero-event and unverified samples;
the complete Native Journey still requires causal import and receiver paint.

A Native comment LIKE timeout must preserve the actual receiver control before
Suite cleanup: count, pressed state, execution state, availability, error
presence and paint geometry. Read the original passive native submission status
separately, and attempt screenshot/DOM capture even if either observation fails.
The first timeout remains the primary exception. Do not refresh a thread,
change the expected count, replay a command or extend its original 120-second
wait to manufacture convergence. A timeout without rejected state does not
identify a delivery, projection or presentation failure.

Run `python3 -m unittest
tooling.acceptance.gates.social.test_public_feed_native`; failure observation,
submission observation and rendering capture must fail independently without
replacing the original error. Successful LIKE verification adds no failure read
or capture. The same source-bound Native Journey remains required.
