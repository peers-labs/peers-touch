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
