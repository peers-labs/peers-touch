# Chat Lifecycle - Design Decisions

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-16 | **Updated**: 2026-09-17
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

The new plan starts at 0/11 current-proven capabilities despite substantial
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

Required live calling is one-to-one audio and video using sealed `CallSignal`,
the shared Realtime stream, WebRTC direct ICE, and TURN fallback. The call
runtime survives Chat page navigation and owns media teardown.

### Scope decisions

- Required now: audio/video ring, accept/reject, no-answer, active media,
  mute, camera toggle, microphone/camera selection, reconnect, hangup,
  direct/TURN, and cross-Station signaling.
- Deferred: group calls, recording, transcription, screen sharing, and durable
  call-history cards.
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
