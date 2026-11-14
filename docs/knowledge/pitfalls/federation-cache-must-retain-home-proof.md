---
kind: pitfall
title: Federation profile caches retain original Home-signed bytes
status: active
owns:
  - apps/station/frame/touch/federation/cache/
  - apps/station/frame/touch/federation/resolver/
  - apps/station/frame/touch/model/db/actor.go
  - apps/station/app/subserver/federation/handler_catalog.go
referenced-by: []
related:
  - ../../architecture/domains/social/federation/interaction-completion.md
detected: 2026-11-08
---

An Actor display projection cannot reconstruct a signed profile envelope.
Returning such a reconstructed envelope through the scoped resolver made Native
verification of non-follower Feed comments fail with
`ACTOR_IDENTITY_INVALID_PROOF`.

The original Actor cache retains complete canonical Home-signed envelope bytes
in the same Actor row. A cache hit verifies the current locator revision,
membership, Home binding, pinned key, signature and expiry. Rows without the
original proof are cache misses and refetch through the original resolver.

Detect recurrence with the cache and resolver Go regressions and the
`social-public-feed-native-e2e` non-follower Journey. Returning an unsigned
display envelope as `signed_profile` or changing signed bytes during cache
reconstruction must fail.
