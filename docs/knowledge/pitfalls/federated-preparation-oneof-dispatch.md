---
kind: pitfall
title: Federation preparation must dispatch every active variant
status: active
owns:
  - apps/station/app/subserver/conversation/production_peer_routes.go
  - apps/station/app/subserver/conversation/production_capabilities.go
  - apps/station/app/subserver/conversation/production_http.go
  - model/domain/chat/conversation_api.proto
referenced-by: []
related:
  - ../../architecture/domains/chat/messaging/design.md
detected: 2026-10-18
---

# Federation preparation must dispatch every active variant

## Symptom

After Group ownership moved to Bob on another Station, Alice's signed leave
intent persisted but the Group retained Alice. Bob's delegated membership
preparation returned HTTP 500 because the Authority peer endpoint returned 403.

## Root cause

The forwarding client selected the existing `membership_request` oneof variant.
The Authority handler read only `GetRequest()` and rejected the valid membership
variant before it reached canonical membership preparation. A forwarding test
proved serialization but did not exercise Authority receive dispatch.

## Mitigation

- Dispatch both active preparation variants at the existing peer endpoint.
- Bind peer identity, Actor, Device, Conversation, Federation and authority
  epoch before entering canonical membership preparation.
- Match the requester to its verified Home Station endpoint manifest.
- Persist only the invisible authority plan during preparation; leave intent
  and final MLS membership command remain the existing durable owners.

## How to detect a recurrence

From `apps/station/app`, run:

```bash
GOWORK=off go test ./subserver/conversation -run 'TestFederatedMembershipPrepareDispatchesRemoteOwnerAndFencesClaims|TestForwardPrepareMembershipUsesCanonicalFederationPrepareRoute' -count=1
```

The receiver regression must accept remote-owner delegated leave, preserve
committed authority, and reject mismatched claims and Home Station routes without
persisting another plan. `chat-native-interactions-e2e` and
`chat-lifecycle-interactions-group-e2e` must independently prove ownership
transfer, later owner actions, leave, dissolve and restart-stable history.

## Crosswalks

- Messaging design §6.3 defines both preparation variants and atomic membership.
- Chat lifecycle `CHAT-J04` defines complete Group management.
