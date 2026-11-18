---
kind: pitfall
title: Private followers must consume remote subscriptions
status: active
owns:
  - apps/station/app/subserver/social/infrastructure/private_followers.go
  - apps/station/app/subserver/social/infrastructure/private_followers_test.go
  - apps/station/app/subserver/social/infrastructure/private_content_authority.go
  - apps/station/app/subserver/social/infrastructure/private_object_store.go
  - apps/station/app/subserver/social/infrastructure/feed_subscription_store.go
related:
  - docs/architecture/shared/security/secure-content/design.md
  - docs/architecture/domains/social/federation/actor-feed-log.md
detected: 2026-11-16
---

# Private followers must consume remote subscriptions

## Symptom

The cross-Station private Native Journey followed the author through the real
recipient client but FOLLOWERS prepare failed with SOCIAL_PRIVATE_INVALID_ARGUMENT.
The author's Station had an enabled authenticated remote subscription and no
local follow row for that subscriber.

## Root cause

Private audience preparation and current read authorization both enumerated only
the local follows table. The remote follow owner persists that edge at the
subscriber Home Station and delivers its revisioned subscription to the author
Station through the existing authenticated Feed receiver.

## Mitigation

The shared private follower predicates consume the original local graph and
Home-bound remote subscription projection. Snapshot commitments include remote
subscription revisions; subscription changes acquire the existing audience
fence before the subscription row lock. Disabled subscriptions and mismatched
Homes cannot be rescued by stale remote follow mirrors. Existing block checks
still apply to preparation and current reads.

## How to detect a recurrence

Run from apps/station/app:

```bash
go test ./subserver/social/infrastructure -run 'TestPrivateFollowers'
```

These checks cover mixed locality, current reads, CUSTOM_DENY, reverse block,
unsubscribe and stale replay. Then run the original
social-private-desktop-e2e Native Journey through the shared Acceptance runner.
Do not seed a new audience table or weaken the nonempty-audience error to make
that Journey pass.
