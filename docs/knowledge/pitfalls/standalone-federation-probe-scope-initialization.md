---
kind: pitfall
title: Standalone Federation probes initialize peer scopes
status: active
owns:
  - tooling/acceptance/fixtures/social_private_delivery_probe
  - tooling/acceptance/gates/social/cross_station_delivery.py
referenced-by: []
related:
  - docs/architecture/domains/social/cross-station/integration.md
detected: 2026-11-16
owner: Social / Federation
review-cadence: on-change
---

# Standalone Federation probes initialize peer scopes

## Symptom

AS24's first duplicate replay failed before HTTP ingress, while the original
outbox and receiver snapshots succeeded. The transport refused to mint its
Federation delivery token.

## Root cause

The standalone Go probe bypassed Station composition, which installs canonical
peer scopes. `NewHTTPTransport` does not install them; `authfed.Mint` rejects
an unregistered delivery scope before any network request.

## Mitigation

The probe's `newReplayTransport` calls the existing `RegisterPeerScopes` before
constructing the production transport. Existing policies, signed frames and
seven receiver replay assertions remain unchanged. A conflicting policy prevents
construction, including when the registry already contains other scopes.

The untrusted-signature mutation must also retain the real source and outer
peer token. Changing the source alias while signing with the real Station key
does not construct a foreign signature. The fixture now signs only the inner
frame with a fresh in-memory Ed25519 key under the real source key ID, without
registering or persisting it. Its regression verifies valid outer authentication
and production `VerifyFrame` rejection. AS24 writes immutable original
before/response/after diagnostics before checking the exact typed result and
unchanged receiver rows; failure diagnostics never publish a partial Suite.

## How to detect a recurrence

From `apps/station/frame`:

```bash
go test -race ../../../tooling/acceptance/fixtures/social_private_delivery_probe.go \
  ../../../tooling/acceptance/fixtures/social_private_delivery_probe_test.go \
  -run '^TestPrivateDeliveryReplayTransport' -count=1
```

The original delivery source Gate runs these checks. The fresh-registry test
requires a source-signed token bound to the original frame, actual protobuf HTTP
transmission and the typed duplicate result; it repeats after sealing.
The conflicting-policy test must fail construction. Formal receiver behavior
still requires AS24 in the original Native Suite.
`TestPrivateDeliveryReplayTransportRejectsUntrustedFrameSignature` must prove
the same signed wire reaches HTTP with valid peer authentication and returns
the unauthenticated terminal result. The runtime-owner tests must retain actual
wrong dispositions and changed row hashes/counts even when assertions fail,
and reject overwriting those observations.
