# Chat Lifecycle - Acceptance Matrix

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-09-16 | **Updated**: 2026-09-22
> **Owner**: Chat Product Team

---

## 1. Acceptance Rule

```text
Capability -> Journey -> visible state -> owner truth
           -> sender action -> receiver result -> durable readback
           -> failure recovery -> cleanup -> current-source evidence
```

`PROVEN` requires a successful current exact-source run. Historical evidence,
static checks, API-only tests, mocks, screenshots, and source presence remain
supporting evidence only.

## 2. Capability Crosswalk

| Capability | Journey | Gate | Receiver assertion |
|---|---|---|---|
| CHAT-C01 discovery | J01 | CHAT-G01 | Search returns the intended local or federated person with stable identity and actionable failure |
| CHAT-C02 relationship | J01 | CHAT-G02 | Both users observe the same accepted/rejected relationship without duplicate effects |
| CHAT-C03 conversation entry | J01 | CHAT-G03 | Message opens exactly one peer-bound Direct conversation and preserves inline retry on failure |
| CHAT-C04 durable text | J01-J02 | CHAT-G04 | Receiver sees exact plaintext once; sender sees truthful queued/delivered/read/failure state |
| CHAT-C05 projection | J02 | CHAT-G05 | Active transcript, list, per-conversation unread attribution, latest-message preview, pagination, local search, settings, and restart readback agree |
| CHAT-C06 attachments | J03 | CHAT-G06 | Receiver opens byte-identical encrypted image/file/screenshot content after retry and restart; screenshot selection preserves Desktop geometry |
| CHAT-C07 voice notes | J03 | CHAT-G07 | Receiver plays byte-identical recorded audio with duration, progress, seek, and retry |
| CHAT-C08 interactions | J02/J04 | CHAT-G08 | Reply/thread/edit/retract/reaction/pin/read/typing converge for Direct and Group without false failure after accepted submission |
| CHAT-C09 group lifecycle | J04 | CHAT-G09 | All active members agree on membership, role, MLS epoch, content, and terminal history state |
| CHAT-C10 live voice/video | J05 | CHAT-G10 | Both users exchange the requested audio/video media through direct and TURN paths and converge on terminal state |
| CHAT-C11 continuity | J07 | CHAT-G11 | Offline, restart, multi-device, revoke, recovery, and cross-Station flows preserve exact truth |
| CHAT-C12 group live voice/video | J09 | CHAT-G14 | Three or more authorized members exchange group audio/video, converge on participant state, and exclude removed or revoked endpoints |
| All required Mobile claims | J06 | CHAT-G12 | Mobile completes the same required outcomes with native lifecycle and permission behavior |
| CHAT-C04-C09/C11/C13; CCU-E01-E05 | CHAT-J02-J04/J06-J07/J10-J11; CCU-J01-J05/J07-J08 | CHAT-G15 | Proto, Core contract, command/error/event fixture consistency across Desktop and Mobile clients; supporting contract proof only |
| CHAT-C04-C09; CCU-C01-C07 | CHAT-J02-J04/J06; CCU-J01-J04 | CHAT-G16 | Desktop↔Mobile Direct, Group, interaction, typing, and attachment converge bidirectionally on the same Station |
| CHAT-C04-C05/C08-C09/C11; CCU-C01-C07 | CHAT-J02/J04/J07; CCU-J01-J05 | CHAT-G17 | Federation, offline, duplicate, restart, and readback hold across Desktop↔Mobile on different Stations |
| CHAT-C04-C05/C08/C11/C13; CCU-C01-C03/C05/C08; CCU-E09 message/read | CHAT-J07/J10; CCU-J05/J07 | CHAT-G18 | Fan-out, read convergence, revoke, scope isolation, and recovery across Desktop + Mobile same-actor devices |
| CHAT-C10-C11/C13; CCU-C07/C08; CCU-E09 call resolution | CHAT-J07/J11; CCU-J08 | CHAT-G19 | Dual-ring, first-terminal-action-wins, handled-elsewhere across Desktop + Mobile |
| CHAT-C08-C09/C11; CCU-C01/C02/C04/C05 | CHAT-J04/J07; CCU-J02 | CHAT-G20 | 3-actor membership, MLS epoch, remove/rejoin across Desktop + Mobile mixed clients |
| CCU-E06-E08 | CCU-J06 | CHAT-G21 | Structural prerequisite only: source, registry, descriptor, generated, runtime, schema, test, script, and current-doc dimensions contain zero legacy Chat references |
| CCU-C01-C08 / CCU-E01-E09 | CCU-J01-J08 | CHAT-G22 | CCU aggregate only: all required cells use the same exact source and every CHAT-G15-G21 result passes |
| Release claim | J08 | CHAT-G13 | CHAT-G00-G12, CHAT-G14-G22 pass at one exact source with zero unresolved product gaps |

## 3. Gate Definitions

### CHAT-G00: Safety And Evidence Integrity

- Production source contains no undeclared debug HTTP egress.
- Acceptance observations originate from the production result, not fixture
  echo or injected expected values.
- Required Mobile scenarios are executable and produce typed blocked evidence
  instead of missing-metadata crashes.
- Capability inventory reports source, historical evidence, and current proof
  as separate fields.

### CHAT-G01-G03: Discovery To Conversation

- A previously authenticated native account cold-launches directly when its
  session is restorable; a configured PIN routes only to PIN entry, while a
  missing/revoked session routes to provider authentication.
- A user performs local search, exact federated-handle resolution, and
  Station-scoped search in Native UI.
- Sender and receiver perform request, pending, accept, reject, duplicate, and
  retry states.
- Repeated attempts for one counterparty PTID render as one selectable person
  row with current state and total attempt count; terminal history opens the
  same person profile without friend-only actions.
- Identity summary shows the authoritative human-readable Station name, while
  PTID, Station peer ID, handle, and Federation ID are expandable and copyable.
- Accepted relationship creates or reuses one Direct conversation.
- Conversation creation failure keeps the selected peer and exposes inline
  retry.
- Client restart reopens the same Direct identity from durable projection
  instead of creating a duplicate.

### CHAT-G04-G05: Daily Direct

- Two native clients exchange unique text in both directions.
- Offline delivery, reconnect, client restart, Station restart, duplicate
  delivery, and submitted-command reconciliation preserve identity/order.
- Queued, retrying, failed, delivered, and read states are distinct.
- A received message appears in the active transcript without manual refresh.
- Entering Chat may clear the aggregate navigation badge, but unread counts
  remain attributed to unopened conversation rows until each row is read.
- Each affected conversation row immediately shows the latest message and
  timestamp, and the same preview survives cold start.
- Older-history pagination, local search, settings, and cold-start readback
  agree with durable owners.
- Direct headers, list rows, and detail surfaces lead with human-readable
  Station identity; presence comes from Station snapshots plus realtime events
  and renders unavailable when authority cannot be queried.
- A selected local background previews immediately while upload and durable
  settings persistence continue asynchronously; failure rolls back the preview
  and keeps retry available.
- Message search targets canonical Conversation projections, finds known local
  plaintext in the active conversation, and keeps its clear action inside the
  input boundary.
- Clearing a conversation removes its eligible data only from the current
  device, remains effective after restart, and allows later messages to arrive.

### CHAT-G06-G07: Rich Media And Voice Notes

- Image/file and recorded-audio messages use the production encrypted
  attachment path.
- Sender and receiver attachment IDs, byte hashes, private metadata, and
  visible message identity agree.
- Upload/download interruption, retry, restart, and recovery are exercised.
- Screenshot selection and confirmation preserve the Desktop window bounds and
  renderer geometry without a visible scale flash.
- Voice capture permission, cancel, duration, playback progress, seek, pause,
  resume, end, and failure states are visible.

### CHAT-G08-G09: Interactions And Groups

- Direct and Group reply/thread, edit, retract, reaction, pin, read, and typing
  converge after offline/restart/duplicate paths.
- A committed thread reply never shows a terminal send failure; root reply
  count, thread panel, peer projection, and restart readback use the same
  message IDs and order.
- Group create, add/remove, leave, role/owner change, rename, dissolve, and
  entitled-history behavior use Conversation-owned commands.
- Removed/revoked endpoints observe no future private content.

### CHAT-G10: Live One-To-One Voice And Video

- Two native clients prove incoming/outgoing ringing, accept, reject, no-answer,
  microphone/camera permission denial, active audio, local and remote video,
  mute, camera toggle, input/camera selection, direct ICE, TURN fallback,
  reconnect, and hangup.
- Text messaging remains operational during a call.
- Station logs contain no sealed signaling plaintext, SDP, candidate address,
  TURN credential, or media payload.
- All media tracks, peer connections, timers, and call projections are released.

### CHAT-G14: Group Live Voice And Video

- Three or more native clients start, receive, join, decline, leave, reconnect,
  and end one audio and one video call from an authoritative Group conversation.
- Every joined client observes the same room identity, participant roster,
  speaking state, mute state, camera state, and terminal result.
- Late join, membership removal, and device revoke converge without duplicate
  participants or future signaling/media delivery to unauthorized endpoints.
- Permission, capacity, membership, network, and media failures remain distinct
  and actionable while the Group conversation stays usable.
- The production media topology uses the accepted SFU boundary and never falls
  back to an unbounded peer-to-peer mesh.
- Client media, SFU participation, timers, and projections are released after
  leave, terminal failure, or room end.

### CHAT-G11-G12: Continuity And Mobile

- Multi-device fan-out, revoke, fresh-install recovery, and cross-Station
  Direct/Group use the same logical identities and no fallback owner.
- Mobile proves discovery through message, rich media, voice note, group,
  interaction, and live voice on required native cells.
- Background/resume, permission, audio route, keyboard, and safe-area behavior
  are included where material.

### CHAT-G13: Release Aggregate

- Current exact source is clean and bound to every result.
- All CHAT-G00-G12, CHAT-G14-G22 results pass in the required runtime-cell
  matrix.
- Gap detector, quality evidence, completion audit, and independent review have
  no unresolved required finding.

### CHAT-G15: Client Contract Conformance

- Desktop and Mobile clients consume the same Proto definitions and Core
  contract surface.
- Command, error, and event fixture sets are structurally identical across both
  clients.
- No client-specific workaround bypasses a shared contract type, field, or
  error code.
- Upstream dependency: CHAT-G04 (durable text), CHAT-G08 (interactions).

### CHAT-G16: Desktop↔Mobile Same-Station End-To-End

- One Desktop actor and one Mobile actor on the same Station exchange Direct
  text, attachment, voice note, interaction, and typing in both directions.
- Group conversation with Desktop + Mobile members converges on membership,
  content, and interaction state.
- Queued, delivered, read, failed, and retry states agree across mixed clients.
- Upstream dependency: CHAT-G04-G10.

### CHAT-G17: Desktop↔Mobile Cross-Station End-To-End

- One Desktop actor and one Mobile actor on different Stations (federated)
  exchange Direct text and verify offline delivery, duplicate suppression,
  restart readback, and reconnect.
- Cross-Station Group with mixed Desktop + Mobile members converges on
  membership and content.
- Image, file, and voice attachment transfer preserves message/attachment
  identity, private metadata and byte hash across the Station boundary, then
  reopens from the verified local cache after restart.
- Upstream dependency: CHAT-G04-G05, CHAT-G08-G11.

### CHAT-G18: Desktop↔Mobile Multi-Device End-To-End

- Same actor with one Desktop and one Mobile device both online: message
  fan-out delivers to both devices without duplication.
- Read cursor advanced on one device converges monotonically on the companion
  device without manual interaction.
- Message sent from one device appears on the companion via durable projection
  upsert, not page refresh.
- Revoke on one device removes future delivery and signaling authority from
  that endpoint.
- Scope isolation: each device projection operates independently; a failure on
  one device does not corrupt the sibling.
- Recovery: fresh-install device restores the same canonical state as the
  surviving device.
- Upstream dependency: CHAT-G04, CHAT-G09, CHAT-G11.

### CHAT-G19: Desktop↔Mobile Call Resolution End-To-End

- Incoming 1:1 call rings simultaneously on Desktop and Mobile owned by the
  same actor under one `call_id`.
- Accept on one device transitions the other to `handled_elsewhere` within one
  signaling round-trip.
- Reject on one device terminates ringing on the sibling.
- No device generates a duplicate call attempt or enters the active media
  session after the sibling has already handled the call.
- Concurrent accept/accept and accept/reject use one durable compare-and-set;
  the winner's retry is idempotent and the loser receives
  `CALL_ALREADY_HANDLED`.
- Station restart or replica failover preserves the committed winner.
- A partitioned sibling discovers `handled_elsewhere` after reconnect.
- A call older than the validated `call_id` expiry window cannot ring again or
  reopen arbitration.
- Winner media setup failure ends visibly and retry creates a new `call_id`.
- Malformed/future ULIDs, conflicting duplicate CALL_REQUEST payloads,
  caller/callee/session mismatches, and revoked or ineligible endpoints are
  rejected without creating or changing the resolution row.
- A terminal action after `NO_ANSWER`, durable-CAS unavailability, and a
  cleanup/admission race all fail closed without selecting a second winner.
- Upstream dependency: CHAT-G10.

### CHAT-G20: Desktop↔Mobile Group MLS End-To-End

- Three actors with mixed Desktop and Mobile clients create a Group, exchange
  messages, and verify MLS epoch convergence.
- Add/remove/rejoin, role change, owner transfer, leave and dissolve update the
  authoritative membership/terminal projection and MLS epoch on all remaining
  mixed-client endpoints.
- Removed or left endpoints retain only entitled history and receive no future
  content; dissolved groups reject new sends.
- Upstream dependency: CHAT-G09.

### CHAT-G21: Client Legacy Zero Reference

The Gate emits one count and evidence reference for each mandatory dimension:

1. tracked production source imports and symbol references;
2. Tauri invoke/command registry entries;
3. Desktop HTTP gateway route/dispatch entries;
4. compiled Proto descriptors;
5. generated Go/Rust/TypeScript manifests and artifacts;
6. mixed-client runtime traces;
7. legacy store/repository/schema/table owners and read/write paths;
8. tests, fixtures, mocks, Acceptance Gates and scripts;
9. current-source architecture/platform/developer documentation.

Renamed wrappers, generic dispatch, aliases, bridges, compatibility flags and
transitive build dependencies count as violations. Missing input, unavailable
inspection, or absent evidence for any dimension returns `UNPROVEN`; no
dimension may be `SKIPPED`.

### CHAT-G22: Client Unification Aggregate

- All CCU required runtime cells (§5) use the same exact source commit.
- CHAT-G15-G21 all pass with current exact-source evidence.
- No CCU gate is in `FAIL`, `BLOCKED`, `PARTIAL`, `UNPROVEN`, or `NOT_RUN`
  state.

## 4. User-Reported Regression Lock

These rows are mandatory Acceptance assertions. A broad Gate pass is invalid
when its named assertion is absent from the Gate report.

| ID | Reported behavior | Owning closure | Required Gate | Required receiver evidence |
|---|---|---|---|---|
| CHAT-UR01 | Known account asks for credentials instead of direct resume or PIN | `chat-onboarding` | `chat-lifecycle-onboarding-e2e` | Cold launch reaches the authenticated shell with a restorable no-PIN session; PIN and reauthentication branches remain distinct |
| CHAT-UR02 | Active conversation does not show the newest received message | `chat-direct` | `chat-lifecycle-direct-e2e` | Receiver DOM shows the exact new message without reload |
| CHAT-UR03 | Aggregate unread clears but no conversation identifies unread ownership | `chat-direct` | `chat-lifecycle-direct-e2e` | Aggregate badge and row badges are observed separately; unopened rows retain exact counts |
| CHAT-UR04 | Conversation/session row omits the latest message after receipt | `chat-direct` | `chat-lifecycle-direct-e2e` | Matching row shows exact latest body/type and timestamp before and after restart |
| CHAT-UR05 | Thread reports failure after send and diverges between participants | `chat-interactions-group` | `chat-lifecycle-interactions-group-e2e` | Accepted send has no failure state; root count and both thread panels converge on identical IDs/order |
| CHAT-UR06 | Screenshot confirmation visibly shrinks or flashes the app | `chat-rich-voice` | `chat-lifecycle-rich-voice-e2e` | Native window and renderer geometry are equal before capture and after confirmation/cancel |
| CHAT-UR07 | One-to-one voice and video calls do not complete | `chat-live-voice` | `chat-lifecycle-live-voice-e2e` | Two native clients complete audio and video calls with real media, signaling, controls, teardown, and direct/TURN evidence |
| CHAT-UR08 | Repeated friend requests render one row per attempt and terminal rows cannot be opened | `chat-onboarding` | `chat-lifecycle-onboarding-e2e` | One row exists per counterparty PTID, shows the total attempt count and current state, and every terminal row opens the same person profile |
| CHAT-UR09 | Contact summary exposes raw Station peer ID instead of a readable Station name | `chat-onboarding` | `chat-lifecycle-onboarding-e2e` | Summary shows authoritative Station name; collapsed details expand to copy canonical PTID, Station peer ID, handle, and Federation ID |
| CHAT-UR10 | Direct Chat exposes raw Station IDs or guesses online/offline state | `chat-direct` | `chat-lifecycle-direct-e2e` | Header, row, and detail show authoritative Station name; raw IDs are expandable; presence is snapshot/event-derived or explicitly unavailable |
| CHAT-UR11 | Selecting a local chat background waits for upload before changing the visible surface | `chat-direct` | `chat-lifecycle-direct-e2e` | The selected local image previews in the same interaction frame; upload/persistence completes in background and failure rolls back with retry |
| CHAT-UR12 | Search cannot find known conversation messages and the clear affordance is detached from the input edge | `chat-direct` | `chat-lifecycle-direct-e2e` | Search resolves the active canonical conversation and finds exact durable text; the clear control remains inside the input suffix boundary |
| CHAT-UR13 | Current-device conversation cleanup is reversible, affects another device, or allows old plaintext to return | `chat-direct` | `chat-lifecycle-direct-e2e` | Clear commits a verified sequence/hash floor, removes eligible local projection and search data, offers no undo, remains effective after restart, leaves the peer device unchanged, and accepts later messages |

## 5. Required Runtime Cells

| Cell | Required coverage |
|---|---|
| macOS native Desktop | CHAT-G01-G11, G14 |
| Linux native Desktop | CHAT-G04, G06, G08-G11, G14 |
| Windows native Desktop | CHAT-G04, G06, G08-G11, G14 |
| iOS native Mobile | CHAT-G01-G12, G14 |
| Android native Mobile | CHAT-G01-G12, G14 |
| Same-Station two actor | G01-G10 |
| Cross-Station two actor | G01-G05, G08-G11 |
| One actor, two active devices, one revoked device | G04, G09, G11 |
| Same-Station group with at least three actors | G14 |
| Cross-Station group with at least three actors | G14 |
| macOS Desktop ↔ iOS Mobile, same Station | CHAT-G15-G16, G19-G20 |
| macOS Desktop ↔ Android Mobile, same Station | CHAT-G15-G16, G19-G20 |
| Linux Desktop ↔ Android Mobile, same Station | CHAT-G15-G16, G19-G20 |
| Windows Desktop ↔ Android Mobile, same Station | CHAT-G15-G16, G19-G20 |
| macOS Desktop ↔ iOS Mobile, cross Station | CHAT-G17, CHAT-G19 |
| Linux Desktop ↔ Android Mobile, cross Station | CHAT-G17, CHAT-G19 |
| Windows Desktop ↔ Android Mobile, cross Station | CHAT-G17, CHAT-G19 |
| Desktop + Mobile, same actor multi-device | CHAT-G18-G19 |
| Desktop + 2 Mobile, 3-person group | CHAT-G20 |
| Any endpoint cold start / process termination | CHAT-G16-G18 |
| Legacy reference scan (all platforms) | CHAT-G21 |
| CCU aggregate (all CCU cells) | CHAT-G22 |

## 6. Current Baseline

At the current amendment working tree based on
`d89e27795eb197cbd34caed46fb03e2430b43d0a`, no CHAT-G00-G12 or
CHAT-G14-G22 Gate has exact-source product proof. Historical Chat runs are
evidence of feasibility, not readiness. See `current-capability-audit.md`.

## 7. Completion Rule

Any required Gate in `FAIL`, `BLOCKED`, `PARTIAL`, `UNPROVEN`, `NOT_RUN`, or
stale-source state keeps the corresponding capability and overall Chat
readiness unproven. This applies to CHAT-G00-G12, CHAT-G14-G22.
