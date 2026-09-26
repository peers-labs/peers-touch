# Chat Lifecycle - Design Decisions

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-09-16 | **Updated**: 2026-09-26
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
| CCU-D01 | Desktop extracts dedicated `messagingRuntime` from `socialRealtime` | accepted |
| CCU-D02 | Proto owns cross-process contracts, Messaging Core owns local contracts | accepted |
| CCU-D03 | Per-capability atomic hard-cut, no deferred deletion phase | accepted |
| CCU-D04 | Inherit full Chat Lifecycle platform matrix | accepted |
| CCU-D05 | Multi-dimensional zero-reference gate | accepted |
| CCU-D06 | Single durable control-plane call resolution per call_id | accepted |

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

## CCU-D01: Desktop Extracts Dedicated `messagingRuntime` From `socialRealtime`

**Status**: accepted
**Date**: 2026-09-22

### Context

Desktop currently mixes Social and Chat refresh ownership in
`socialRealtime`, while command submission is spread across UI components and
the combined `socialChat` store. That split prevents identity-scope fencing and
cannot prove Desktop/Mobile runtime equivalence.

### Decision

`apps/desktop/src/messaging/runtime.ts` is the single Desktop Web domain owner
for Chat command admission, projection-event consumption, periodic
reconciliation, and actor/Station/endpoint scope reset.
`apps/desktop/src/runtimes/messagingRuntime.ts` is only the Kernel
`RuntimeDescriptor` adapter. The native Device Messaging Engine remains the
durable command and private-projection owner.

The runtime is session-scoped. Before activating a new scope it invalidates all
queued callbacks, timers and dedupe state from the previous generation and
clears the previous Chat projection. Every asynchronous completion verifies the
active generation before writing.

`socialRealtime` retains friendship, contact, profile, presence, Social
notifications and the shared Realtime stream supervisor. It may read typed
Conversation projection when resolving Social identity decoration, but it
cannot load or mutate messages, conversations, receipts, typing, attachments,
unread counts or Chat settings. Social graph changes that affect Chat publish a
typed reconciliation hint consumed by the Messaging runtime.

UI and stores submit Chat operations through the domain runtime. Low-level
`im-service` and `desktop_api` functions remain transport adapters and are not
imported directly by production Chat UI.

### Rejected

- Keep Chat in `socialRealtime` — makes mixed-client proof impossible since
  lifecycle boundaries differ.
- Merge all into `messagingRuntime` — couples Chat and Social lifecycle
  unnecessarily.
- Keep `messagingRealtime` and the Kernel descriptor as two lifecycle owners —
  leaves bootstrap, teardown and scope invalidation ambiguous.

### Consequences

Positive: one lifecycle owns commands and freshness, identity changes fail
closed, and Desktop can be compared with Mobile's Messaging runtime.

Negative: the domain runtime needs an explicit projection port and command
facade; Social events that affect Conversation projection require a typed
handoff rather than direct store writes. Integration tests must prove runtime
coexistence, stale-generation rejection and teardown.

### Reversal Trigger

Only a reviewed replacement that preserves one Chat owner, generation-fenced
scope reset, canonical command admission and independent Social ownership may
supersede this decision.

## CCU-D02: Proto Owns Cross-Process Contracts, Messaging Core Owns Local Contracts

**Status**: accepted
**Date**: 2026-09-22

### Decision

Type mapping and generation only flow from canonical Chat Proto. No
platform-specific re-definition of Friend/Group/Message/CommandStatus domain
model. Desktop/Mobile share contract fixtures from canonical Proto.

Projection-change notifications carry scope identity and a monotonic generation
or cursor; they are invalidation hints and never a second business truth.
Unknown fields are ignored only at the protobuf boundary. Unknown enum values,
unsupported commands and version skew fail closed with typed errors.

Wire/Core states map to the user-visible vocabulary defined by
`product-state-model.md §4.1`; `prepared` is transient construction state and
`terminal` is an outcome class, not an additional visible state.

### Rejected

- Each platform defines its own types — makes cross-platform proof impossible.
- Shared TS package owns types — TS is not the wire format.

### Consequences

Legacy Friend/Group Proto must be deleted after consumers migrate. Both clients
must test the same fixture bytes and the same state/error mapping.

### Reversal Trigger

Only a reviewed protocol-versioning change may supersede the canonical Proto;
platform convenience types cannot become a parallel domain contract.

## CCU-D03: Per-Capability Atomic Hard-Cut, No Deferred Deletion Phase

**Status**: accepted
**Date**: 2026-09-22

### Decision

Contract/runtime foundations may land before user-visible cutovers only when
they do not create a second production owner. Each behavior closure (Direct,
Group, Interaction/Attachment, Continuity) then simultaneously cuts every
affected Desktop and Mobile adapter/runtime/UI consumer. The same closure
deletes each legacy path that lost its last consumer. The final zero-reference
closure only verifies absence; it never performs deferred migration or
introduces compatibility code.

### Rejected

- "Backend first, frontend later" — leaves dual paths alive.
- Deferred bulk deletion — compatibility shims accumulate.

### Consequences

Each behavior closure is larger but self-contained. Foundation work cannot
claim product completion. No compatibility layer debt remains.

### Reversal Trigger

If a closure is too large, the Plan must split it along a smaller
dependency-closed user outcome before implementation. A compatibility shim is
not an allowed split mechanism.

## CCU-D04: Inherit Full Chat Lifecycle Platform Matrix

**Status**: accepted
**Date**: 2026-09-22

### Decision

CCU inherits all required platform cells from acceptance-matrix.md. Execution
plan can only add risk cells, never reduce already-accepted scope. Unrun cells
remain UNPROVEN, not substituted by other platform PASS.

The Plan must bind macOS, Linux and Windows Desktop; iOS and Android Mobile;
same-Station, cross-Station, same-actor multi-device, mixed Group, restart and
legacy-scan cells. A Gate implementation that returns `SKIPPED` for a required
cell does not satisfy this decision.

### Rejected

- Subset matrix for speed — undermines cross-platform proof.
- Run only macOS+iOS — Android and Linux/Windows coverage is required.

### Consequences

Full matrix may take longer but proves true interoperability.

### Reversal Trigger

If a platform is formally descoped from the product.

## CCU-D05: Multi-Dimensional Zero-Reference Gate

**Status**: accepted
**Date**: 2026-09-22

### Decision

Legacy zero-reference gate checks 9 dimensions: tracked source imports, Tauri
invoke registry, HTTP gateway registry, compiled Proto descriptors, generated
manifests, mixed-client runtime traces, store/schema/table paths,
tests/fixtures/scripts, and current-source docs. Detects renamed wrappers,
generic dispatch, fixture aliases, re-export bridges, compatibility feature
flags.

Every dimension is mandatory and emits its own count and evidence reference.
Missing inputs, unavailable scans and absent prerequisite reports remain
`UNPROVEN`; they cannot be converted to `SKIPPED` or aggregate PASS.

### Rejected

- Text search only — misses renamed paths.
- Manual checklist — not reproducible.

### Consequences

Gate implementation requires registry inspection + runtime trace + descriptor
analysis.

### Reversal Trigger

If a dimension cannot be inspected, completion remains blocked until tooling
can inspect it or the governing product scope is formally changed.

## CCU-D06: Single Durable Control-Plane Call Resolution Per `call_id`

**Status**: accepted
**Date**: 2026-09-22

### Decision

Callee Home Station Realtime control plane owns atomic
first-terminal-action-wins for `(callee_actor_ptid, call_id)`. The decision is a
durable compare-and-set record shared by all Station replicas and retained for
at least ten minutes after the 45-second ring deadline. `call_id` is a
caller-generated ULID; Home Station validates a bounded clock-skew window and
CALL_REQUEST binds caller, callee, session and request digest while creating an
`OPEN` record. The retention window is strictly longer than admission, so an
expired record cannot be recreated after cleanup. Both accept and explicit
reject are terminal; deadline expiry commits `NO_ANSWER`. A duplicate from the
winning endpoint is idempotent and returns the committed result; a competing
endpoint receives `CALL_ALREADY_HANDLED`.

The resolver authenticates the actor and verifies that the requesting endpoint
is currently eligible before the compare-and-set. Cross-Station requests route
to the callee Home Station; caller or foreign Stations never arbitrate. Station
restart, replica failover, SSE reconnect and duplicate delivery read the same
record. Expiry after the retention window removes only replay metadata and
cannot reopen an old call. If the winning endpoint later fails media setup, the
call ends visibly; retry uses a new `call_id`.

Station persists only the bounded control record defined in `data-model.md`:
state, caller/callee PTID, session, `call_id`, request digest, ring deadline,
winning device, terminal action, terminal timestamp and expiry. It never
stores SDP, ICE, media, keys or sealed signaling plaintext.

### Rejected

- Client-side resolution — race conditions across devices.
- Full SDP in Station — violates E2E encryption boundary.

### Consequences

Positive: concurrent devices, retries and Station replicas converge on one
terminal action.

Negative: Realtime requires a bounded persistent record, expiry cleanup and a
cross-Station owner route. Mixed-device proof must cover concurrent
accept/reject, duplicate winner retry, Station restart, partition recovery,
expiry and winner media failure.

### Reversal Trigger

Only measured latency or availability evidence from the required runtime cells
may justify a reviewed replacement that preserves one atomic owner and the
privacy boundary.

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
