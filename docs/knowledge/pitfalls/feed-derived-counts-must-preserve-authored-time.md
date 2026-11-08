---
kind: pitfall
title: Feed derived counts must preserve authored timestamps
status: active
owns:
  - apps/station/app/subserver/social/infrastructure/feed_interaction_projector.go
  - apps/station/app/subserver/social/infrastructure/feed_interaction_projector_test.go
  - apps/desktop/src/services/publicFeedProjection.ts
referenced-by: []
related:
  - ../../architecture/domains/social/federation/actor-feed-log.md
detected: 2026-11-08
---

# Feed derived counts must preserve authored timestamps

A valid public post can become `FEED_PROJECTION_TAMPERED` after a reaction
because the Native consumer compares the entire authored body, including time.
GORM `Update` changes `updated_at` automatically when projecting a derived
reaction count. That timestamp then differs from the author's signed event.

The interaction projector uses `UpdateColumn` for derived counts. Only authored
post events update post body timestamps. Keep the Native comparison strict;
discarding the timestamp there would conceal an unauthorized body mutation.

## How to detect a recurrence

Verify set and remove through the original projector and compare the preserved
creation/update/edit timestamps as well as the changed count:

```sh
go -C apps/station/app test ./subserver/social/infrastructure \
  -run '^TestFeedInteractionCountsPreserveSignedParentTimestamps$' -count=1
```

The Native public Suite additionally checks that the receiving author continues
to render the signed post after a non-follower's comment and reaction.
