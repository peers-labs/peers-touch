# Chat Lifecycle - Product State Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-16 | **Updated**: 2026-09-16
> **Owner**: Chat Product Team

---

## 1. Discovery And Relationship

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

## 2. Conversation Entry

```text
contact_ready -> opening_existing -> ready
              -> creating_direct -> ready
                                 \-> create_failed
```

`create_failed` retains the selected peer, error reason, and retry action.
Repeated open/create attempts converge on one conversation identity.

## 3. Durable Message

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

## 4. Conversation Projection

```text
unselected -> loading -> ready
                    \-> load_failed
ready -> loading_older -> ready
ready -> stale -> reconciling -> ready
```

Conversation list, unread/read, preview, history cursor, settings, and search
must derive from canonical projections. A no-op loader or page-local cache
cannot be presented as fresh state.

## 5. Attachment And Voice Note

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

## 6. Interaction And Typing

Durable interactions use pending, accepted, or failed-actionable state and
converge through ordered Conversation events. Typing is independent:

```text
idle -> typing -> idle
          |
          +-> disconnected_or_expired -> idle
```

Typing never enters durable history, delivery receipts, or recovery archives.

## 7. Group

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

## 8. Live Voice

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

## 9. Continuity And Trust

```text
online -> disconnected -> reconnecting -> online
active_device -> revoke_pending -> revoked
installed -> restoring -> recovered_fresh_device
```

Failures that cannot preserve exact private state stop at an actionable,
fail-closed state. They never reset storage, silently create a second identity,
or fall back to a legacy authority.

## 10. Forbidden Visible States

- Empty Chat after a user selected a valid contact and creation failed.
- Permanent spinner for search, relationship, queue, MLS, transfer, or call
  failure.
- Failed message rendered as read.
- Group marked ready before authoritative projection.
- Voice note shown as sent when capture or transfer failed.
- Chunked upload described as streaming voice.
- Call controls enabled only because an unrelated P2P status is connected.
- Success based on a fixture value copied into the observed result.
