# Chat Lifecycle - Design Decisions

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-16 | **Updated**: 2026-09-20
> **Owner**: Chat Product Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| CHAT-D01 | Chat readiness starts at discovery and ends at durable continuity | accepted |
| CHAT-D02 | Existing domain owners remain authoritative | accepted |
| CHAT-D03 | Current-source receiver proof is mandatory | accepted |
| CHAT-D04 | Voice notes specialize encrypted attachments | accepted |
| CHAT-D05 | Live voice/video uses Realtime signaling and WebRTC/TURN | accepted |
| CHAT-D06 | Desktop and Mobile claims are independent | accepted |
| CHAT-D07 | Product safety and evidence integrity precede feature proof | accepted |
| CHAT-D08 | Old NDR and Messaging execution plans are historical only | accepted |
| CHAT-D09 | Group live calls are required and need a separate SFU design | accepted |
| CHAT-D10 | Presence measures authenticated reachability, not window focus | accepted |

## CHAT-D01: Full Lifecycle Product Boundary

**Status**: accepted
**Date**: 2026-09-16

### Decision

The Chat product boundary begins when a user searches for another person and
ends only after relationship, conversation, content, voice, group, and
continuity outcomes are usable.

### Rationale

Starting acceptance from a pre-created conversation allowed infrastructure
success while the real first-use path remained broken.

### Rejected

- Treating find people and friendship as unrelated Social readiness.
- Treating message delivery as the entire Chat product.

### Consequences

Chat acceptance must compose multiple domain owners and cannot claim readiness
from a pre-seeded happy path alone.

## CHAT-D02: Preserve Domain Ownership

**Status**: accepted
**Date**: 2026-09-16

### Decision

Actor/Federation Discovery owns identity lookup, Social owns relationships,
Conversation owns shared Chat facts, Device Messaging Engine owns private
device processing, Realtime owns call signaling, and Federation owns
cross-Station transport.

### Rationale

A lifecycle product owner coordinates these domains without duplicating their
truth.

### Rejected

- A new Chat service that copies all domain state.
- UI-side joins across fallback endpoints.
- Alias routes or dual writes during cutover.

## CHAT-D03: Current-Source Proof

**Status**: accepted
**Date**: 2026-09-16

### Decision

Only exact-source receiver-perspective evidence may set a capability to
`PROVEN`. Historical results are feasibility/regression references.

### Consequences

The new plan starts at 0/12 current-proven capabilities despite substantial
existing implementation and historical passes.

## CHAT-D04: Recorded Voice Is Durable Rich Content

**Status**: accepted
**Date**: 2026-09-16

### Decision

Recorded voice uses the encrypted attachment data plane with voice-specific
private metadata and UI states. Capture remains local until durable send
admission. Playback begins only from a fully verified local object.

### Required private metadata

- MIME/container and codec;
- duration;
- optional bounded waveform summary;
- attachment identity and integrity commitments.

### Rejected

- Plaintext media metadata at Station.
- Calling resumable chunk transfer streaming voice.
- Sending before recording completion without a separate protocol.

## CHAT-D05: Live Voice And Video Use Existing Realtime Boundaries

**Status**: accepted
**Date**: 2026-09-16

### Decision

Required one-to-one live calling uses sealed `CallSignal`, the shared Realtime
stream, WebRTC direct ICE, and TURN fallback. The call runtime survives Chat
page navigation and owns media teardown.

### Scope decisions

- Required one-to-one closure: audio/video ring, accept/reject, no-answer, active media,
  mute, camera toggle, microphone/camera selection, reconnect, hangup,
  direct/TURN, and cross-Station signaling.
- Required separate closure: group audio/video calls governed by `CHAT-D09`.
- Deferred: recording, transcription, screen sharing, and durable call-history
  cards.
- Ring timeout remains 45 seconds.

### Rejected

- WebRTC DataChannel for text.
- A second signaling stream.
- Client access to a foreign Station.
- Enabling calls based on an unrelated connected-chat transport state.

## CHAT-D06: Independent Platform Claims

**Status**: accepted
**Date**: 2026-09-16

### Decision

Desktop and Mobile share product semantics and core contracts but require
independent native proof. Mobile may adapt presentation and permissions but
cannot silently defer required Chat capabilities.

### Consequences

Desktop implementation or evidence cannot mark Mobile ready.

## CHAT-D07: Safety And Evidence Integrity First

**Status**: accepted
**Date**: 2026-09-16

### Decision

Before feature proof, remove undeclared production debug egress, repair
fabricated or echoed acceptance observations, and make registered native
scenarios fail with typed evidence rather than missing implementation metadata.

### Rejected

- Shipping hard-coded debug collectors temporarily.
- Treating fixture-provided expected values as observed product output.
- Counting a registered but unimplemented Gate as coverage.

## CHAT-D08: Replace The Old Execution Basis

**Status**: accepted
**Date**: 2026-09-16

### Decision

`20260808-messaging-platform.md` and
`20260824-native-desktop-runtime-cells.md` are superseded as execution plans for
this worktree. Their source history and evidence remain readable but cannot
drive active work or readiness.

`20260906-conversation-authority-hard-cut.md` belongs to the
`peers-access-gate` worktree and is neither modified nor tracked here.

## CHAT-D09: Group Live Calls Require A Separate SFU Design

**Status**: accepted
**Date**: 2026-09-18

### Context

Group voice and video are normal daily-social capabilities. Classifying them as
a permanent non-goal would make the Chat readiness claim narrower than the
product promise users reasonably expect.

### Decision

Group audio and video calls are required as `CHAT-C12` and close through
`CHAT-J09`. They are lightweight calls launched from an authoritative Group
conversation, not a scheduled webinar or enterprise meeting suite.

Implementation remains blocked until a separate reviewed architecture defines
the SFU boundary, room authority, participant and device authorization,
membership/revoke behavior, encryption, reconnect, capacity, cross-Station
routing, observability, and cleanup semantics.

### Rejected

- Treating group calls as optional merely because the first call architecture
  covered one-to-one.
- Implementing group media as an unbounded peer-to-peer mesh.
- Reusing one-to-one receiver state as fabricated group participant truth.
- Expanding this capability into calendar scheduling, webinars, recording, or
  transcription without a separate product amendment.

## CHAT-D10: Presence Measures Authenticated Reachability

**Status**: accepted
**Date**: 2026-09-20

### Context

Desktop currently maps window blur/background directly to offline and renews a
90-second Station lease only every five minutes. A two-window conversation can
therefore mark whichever peer loses focus offline, and a continuously active
client expires between heartbeats. Cross-Station queries also read only the
local Station lease table, turning missing remote authority into false offline.

### Decision

Presence means that at least one authenticated runtime for the actor holds a
live Home Station lease. Window focus and visibility are not presence state.
The client renews the lease well inside its TTL; logout, process shutdown,
confirmed network loss, revocation, or lease expiry are the only offline
transitions.

The actor's Home Station remains the sole Presence authority. A client queries
only its own Station. That Station resolves each actor's verified Home Station
through Actor Identity and uses the authenticated Federation peer-call
transport for remote snapshots. Unresolved routing, timeout, invalid
authentication, and omitted results project as unknown, never offline.
Same-Station `PresenceFlip` events remain immediate. Remote presence is
reconciled after realtime reconnect, inbound activity, relationship changes,
and the bounded social-runtime interval.

Client projection applies event-over-snapshot ordering fences so a late
snapshot cannot overwrite a newer realtime transition.

### Rejected

- Treating window blur, minimization, or a hidden Chat page as offline.
- Extending Station lease TTL to mask an under-frequency heartbeat.
- Letting Desktop call a foreign Station directly.
- Treating a missing remote lease or failed route as authoritative offline.
- Creating a chat-owned or UI-owned presence source.

### Consequences

- Background Desktop processes remain online while their authenticated runtime
  can renew the lease.
- Cross-Station presence is bounded eventual state with immediate refresh on
  active conversation traffic and reconnect.
- Presence remains tri-state at client boundaries: online, offline, or unknown.
