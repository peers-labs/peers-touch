---
kind: pitfall
title: Private endpoint identity excludes account hints
status: active
owns:
  - apps/station/app/subserver/social/private_content_ports.go
  - apps/station/app/subserver/social/private_content_endpoint_identity_test.go
related:
  - docs/architecture/domains/identity/unified-actor-system.md
  - docs/knowledge/invariants/actor-identity-boundary.md
  - docs/knowledge/invariants/actor-ref-account-is-persisted-identity.md
referenced-by: []
detected: 2026-11-09
owner: Social
---

# Private endpoint identity excludes account hints

## Symptom

Native private publication commits its encrypted Post and immutable response,
but author point-read repeatedly returns HTTP 404 and the journal remains
`CommittedPendingReadback`. The Post is active and its plan is consumed.

## Root cause

The authenticated point-read endpoint contains PTID, Actor kind and device ID.
Actor Identity issues its verified endpoint manifest with the persisted
`ActorRef.acct` routing hint. Comparing the entire `ActorDeviceRef` with
`proto.Equal` treats the absent hint as a different device and returns
`ErrPrivateContentInactiveEndpoint`.

Handler tests that substitute a private reader do not exercise this production
directory boundary. A successful submit or source-only test therefore cannot
establish a successful author readback.

## Mitigation

The original Social recipient directory checks PTID, device ID and Actor kind
against the verified active manifest. Account hints do not participate in
endpoint authorization. Home Station, manifest validation, revocation and
application audience checks retain their original owners.

Do not fill the caller's account hint from a request host, relax private
readback, repeat a committed submission or bypass manifest verification.

## How to detect a recurrence

- From `apps/station/app`, run `go test ./subserver/social -run
  'TestPrivateActiveEndpoint' -count=1`. It covers identity-only and different
  account hints, missing/unknown devices, Actor kinds, nonlocal Home Station
  and manifest-validation failures.
- Run the original `social-content-search-desktop-native-e2e` Gate through
  `tooling/scripts/acceptance-run.py` against a reviewed development Profile.
  Its unchanged publication budget requires a committed, verified readback.
- The `social-public-feed-source` Gate includes these tests through its original
  Social package regression command.
