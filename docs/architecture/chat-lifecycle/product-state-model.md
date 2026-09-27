# Chat Lifecycle - Product State Model

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-16 | **Updated**: 2026-09-18
> **Owner**: Chat Product Team

---

## 1. Account Continuity

```text
known_account -> restoring_session -> authenticated
known_account -> pin_required -> authenticated
known_account -> reauthentication_required -> authenticated
```

A native restorable session without a configured PIN never routes through the
provider credential form. A PIN-protected session requests only the PIN.
Missing, revoked, or invalid native session state is the only path to provider
reauthentication.

## 2. Discovery And Relationship

```text
idle -> searching -> results
                 \-> no_results
                 \-> search_failed

stranger -> request_sending -> request_pending
                              \-> request_failed
request_pending -> accepted -> contact_ready
                \-> rejected
contact_ready <-> blocked
```

Every failure preserves the query or selected identity and exposes retry.
Neither cached profiles nor a conversation row may fabricate friendship.
Request history is projected by canonical counterparty PTID, never display
name: one person row exposes the latest authoritative state and total attempt
count. Pending, rejected, and accepted rows remain selectable; only accepted
state exposes friend-only actions.

Identity summary prioritizes human-readable Federation and Home Station names.
Canonical PTID, Station peer ID, federated handle, and Federation ID remain
available in an expandable, copyable technical details state.

## 3. Conversation Entry

```text
contact_ready -> opening_existing -> ready
              -> creating_direct -> ready
                                 \-> create_failed
```

`create_failed` retains the selected peer, error reason, and retry action.
Repeated open/create attempts converge on one conversation identity.

## 4. Durable Message

```text
draft -> queued -> submitting -> accepted -> delivered -> read
                    |
                    +-> retrying -> submitting
                    +-> failed_actionable -> queued
```

Rules:

- Only a local draft may be cancelled.
- A durable command timeout remains retrying until canonical readback resolves
  accepted, rejected, or not-found.
- Failed is never rendered as read or delivered.
- Retry reuses the logical message and exact accepted command semantics.

## 5. Conversation Projection

```text
unselected -> loading -> ready
                    \-> load_failed
ready -> loading_older -> ready
ready -> stale -> reconciling -> ready
```

Conversation list, unread/read, preview, history cursor, settings, and search
must derive from canonical projections. A no-op loader or page-local cache
cannot be presented as fresh state.

Local background selection has a separate ephemeral preview projection:

```text
durable_background -> local_preview -> uploading -> durable_background
                                    \-> upload_failed -> durable_background
```

The preview transition is immediate and never persists a local filesystem
reference. Successful upload binds the durable object reference to the already
visible preview; failure removes the preview and exposes retry.

Conversation cleanup is a device-local storage operation:

```text
visible -> confirming -> deleting -> compacting -> cleared
                                      \-> compaction_pending
```

The device freezes a verified authority sequence/hash floor before deleting
eligible projection, search, completed-transfer, and zero-reference media data.
There is no undo state. Ordinary replay cannot restore plaintext at or below
the floor, while later authority events remain eligible for projection.

The aggregate Chat navigation badge and each conversation-row unread count are
separate projections. Entering Chat may clear the aggregate acknowledgement;
it must not clear a row until that conversation is opened and read. A newly
received message updates both the active transcript and the matching row's
latest-message preview without a page remount.

Conversation-list geometry is stable across unread transitions. Each row owns a
fixed trailing status lane, so zero, single-digit, and capped multi-digit unread
counts cannot resize the text column or row height.

## 6. Attachment And Voice Note

```text
capturing -> captured -> preview_ready -> queued
    |           |              |
    +-> denied  +-> discarded  +-> upload_failed -> retrying

queued -> uploading -> transferred -> available -> playing
                            |             |          |
                            +-> retrying  +-> open_failed
playing -> paused -> playing
playing -> ended
```

Required visible fields are duration, transfer state, playback position, seek
position, and actionable retry. The final verified local file is the only
playback source.

Screenshot capture adds a native selection substate:

```text
draft -> capture_selecting -> capture_confirmed -> preview_ready
                         \-> capture_cancelled -> draft
                         \-> capture_failed -> draft
```

Window hiding/restoration may protect the capture but must preserve exact
window geometry and renderer layout without a visible scale flash.

## 7. Interaction And Typing

Durable interactions use pending, accepted, or failed-actionable state and
converge through ordered Conversation events. Typing is independent:

```text
idle -> typing -> idle
          |
          +-> disconnected_or_expired -> idle
```

Typing never enters durable history, delivery receipts, or recovery archives.
A committed thread reply cannot surface a terminal failure. Its root count,
thread panel, peer projection, and restart readback converge on the same
message identity and order.

Thread, reaction, pending-interaction, and emoji-only rendering preserve the
current reading position. Dynamic message measurement may change the owning
row's internal content size, but the timeline must retain either its tail pin
or the top visible message anchor and must not move neighboring content
uncompensated.

## 8. Group

```text
creating -> active
active -> transition_pending -> active
active -> leaving -> left
active -> dissolving -> dissolved
active -> waiting_for_epoch -> recovering -> active
```

Group actions remain pending until authoritative membership and MLS projections
agree. `left`, `removed`, and `dissolved` preserve entitled read-only history
and reject new sends.

## 9. Live One-To-One Voice And Video

```text
idle -> permission_checking -> ringing_out -> connecting -> active
idle -> ringing_in -> permission_checking -> connecting -> active
ringing_in -> rejected
ringing_out -> no_answer
active -> reconnecting -> active
active -> reconnecting -> failed
any_non_terminal -> ended
```

The UI always exposes the current state and an available end/retry action.
Navigation does not terminate an active call. Process exit, logout, identity
switch, or terminal failure releases all media and signaling resources.
Video adds camera permission, local-preview, remote-video, camera-off, and
camera-device states without changing the call signaling lifecycle.

## 10. Group Live Voice And Video

```text
room_idle -> starting -> inviting -> active
starting -> start_failed -> room_idle
invited -> joining -> joined
invited -> declined
joining -> join_failed -> invited
joined -> reconnecting -> joined
joined -> reconnecting -> disconnected
joined -> leaving -> left
active -> ending -> ended
```

Every joined participant projects the same room identity and authorized
participant roster. Mute, camera, speaking, reconnecting, left, removed, and
revoked states are participant-scoped. A membership or device-revoke event
removes future signaling and media authority before the endpoint can rejoin.

The UI keeps the Group conversation available throughout the call, uses stable
participant tiles with active-speaker indication, and exposes permission,
capacity, membership, network, and media failures separately. A group call
never degrades into an unbounded peer-to-peer mesh.

## 11. Continuity And Trust

```text
online -> disconnected -> reconnecting -> online
active_device -> revoke_pending -> revoked
installed -> restoring -> recovered_fresh_device
```

Presence is a tri-state projection over Home Station lease truth:

```text
unknown -> online -> offline
    \---------^        |
      authoritative snapshot/realtime reconciliation
```

Window focus does not participate in this state machine. An authenticated
Desktop runtime renews its lease while reachable; logout, shutdown, confirmed
network loss, revocation, or lease expiry establish offline. Missing or failed
cross-Station resolution remains unknown.

Failures that cannot preserve exact private state stop at an actionable,
fail-closed state. They never reset storage, silently create a second identity,
or fall back to a legacy authority.

## 12. Forbidden Visible States

- Password form shown for a native restorable account that has no PIN.
- Empty Chat after a user selected a valid contact and creation failed.
- Newly received content missing from the active transcript or conversation
  preview.
- Aggregate Chat acknowledgement erasing unread attribution from unopened
  conversation rows.
- Unread-count changes resizing or vertically shifting conversation rows.
- Thread send shown as failed after the authority accepted it, or thread/main
  projections disagreeing on reply identity or count.
- Thread, reaction, or emoji-only state moving the visible message anchor.
- Window blur or hidden state marking a reachable authenticated actor offline.
- Missing remote presence authority rendered as offline.
- Screenshot confirmation resizing or visibly scaling the Desktop window.
- Permanent spinner for search, relationship, queue, MLS, transfer, or call
  failure.
- Failed message rendered as read.
- Group marked ready before authoritative projection.
- Voice note shown as sent when capture or transfer failed.
- Chunked upload described as streaming voice.
- Call controls enabled only because an unrelated P2P status is connected.
- Removed or revoked members remaining in a group-call participant roster.
- Group-call failure presented as a successful join or silently replaced by
  peer-to-peer mesh media.
- Success based on a fixture value copied into the observed result.
