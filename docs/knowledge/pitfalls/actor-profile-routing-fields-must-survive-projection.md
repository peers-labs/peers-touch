---
kind: pitfall
title: Actor profile routing fields must survive projection
status: active
owns:
  - apps/desktop/src/store/friendshipProjection.ts
  - apps/desktop/src/store/socialProfileProjection.ts
  - tooling/acceptance/gates/chat/native_group_mls_runner.py
related:
  - ../../client/desktop/runtime-projections.md
  - ../../architecture/domains/chat/lifecycle/experience-contract.md
detected: 2026-10-18
---

# Actor profile routing fields must survive projection

## Symptom

Native Create Group showed loaded avatars and Federation labels, but both
contacts had empty federated handles and Home Station domains. The displayed
Station label was `Station name unavailable`. Profile fetch and Federation
resolve had both returned successfully.

## Root cause

The signed Profile mapper retained formal `federated_handle`,
`home_station_domain` and `home_station_peer_id` fields. Contact projection
ignored those fields and reconstructed routing metadata from display-oriented
`acct` and `username`. Federation resolution can return local account names
there, so a successful authoritative refresh erased the distinguishing
Station information.

## Mitigation

### What was done in code

Contact projection and peer-profile refresh consume one shared
`remoteProfileHandle` helper. It prefers the formal federated handle, then
accepts canonical handles from account display fields. Both `user@host` from
the resolver cache and `@user@host` from signed envelopes project to the same
display handle. Contact Home Station
domain and PeerID prefer the signed Profile fields. Existing request metadata
remains only a missing-profile fallback.

Native Group MLS retains strict identity, avatar and unclipped metadata
assertions. Its same-name scenario temporarily changes a Fixture actor name
through the real Profile API, publishes the new locator sequence, reconciles
through Social runtime, verifies readback and restores the original name before
client cleanup. Failure capture preserves the observed DOM and
screenshots without rewriting mutable app logs.

### What guards against regression

The `chat-native-group-mls-e2e` identity matrix requires independent observers
to display the same authoritative metadata for each PTID and distinguish
same-name actors by handle and Home Station identity.

## How to detect a recurrence

```bash
pnpm --dir apps/desktop exec vitest run \
  src/store/socialProfileProjection.test.ts \
  src/store/friendshipProjection.test.ts
pnpm --dir apps/desktop run check
```

Run `chat-native-group-mls-e2e` on `desktop-macos-native`. A non-empty avatar or
Federation label cannot substitute for canonical handle and Home Station
evidence.

## Crosswalks

- Desktop Runtime Projections §4 owns profile freshness and the shared cache.
- Chat lifecycle `CHAT-J01` requires truthful distinguishing identity.
