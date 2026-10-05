---
kind: invariant
title: Actor presence is not owned by chat subservers
status: active
owns:
  - apps/station/app/subserver/conversation/
  - apps/station/app/subserver/presence/
  - model/domain/chat/
  - model/domain/presence/
related:
  - docs/architecture/domains/identity/presence-supervisor.md
  - docs/architecture/shared/communication/event-stream.md
detected: 2026-06-19
---

# Actor Presence Ownership

## Must Hold

Actor presence is an identity/session capability. It is owned by
`apps/station/app/subserver/presence/` and observed through the unified
realtime stream.

Chat subservers must not:

- expose `/friend-chat/online`, `/friend-chat/offline`, or feature-specific
  presence streams;
- store actor reachability as chat-local state;
- add `online` fields to chat session/message proto models;
- accept a client-supplied `did` as the actor identity for presence updates.

Chat subservers may:

- query presence through a narrow read API such as `presence.IsActorOnline`;
- enqueue or deliver messages based on that read result;
- react to `StreamEvent.PresenceFlip` only through client/runtime projection
  layers, not through chat-owned transports.

## Why

Presence is about whether an authenticated actor/session/device currently has
a valid lease. That lifecycle starts at login/session restore and ends at
logout, TTL expiry, or session revocation. Chat is only one consumer of this
fact. Letting chat own presence creates false authority, duplicated streams,
and stale UI states when a client misses an event.

## How To Verify

Before merging a change that touches the owned paths, run:

```bash
rg '/friend-chat/(online|offline|presence/stream)|participant_.*_online|OnlineRequest|OnlineResponse' \
  apps/station apps/desktop apps/mobile model/domain
```

The command must return no source-code matches. Historical docs or evidence
artifacts may mention removed APIs, but active code and proto sources must not.

Also verify:

- Station registers `presence.NewPresenceSubServer`.
- Presence events publish as `StreamEvent.PresenceFlip` through `/events/stream`.
- Clients call `/presence/heartbeat` or `/presence/offline` for self presence.
- Chat delivery checks presence through the presence owner, not local maps.
