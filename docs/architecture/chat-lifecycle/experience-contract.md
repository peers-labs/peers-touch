# Chat Lifecycle - Experience Contract

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-16 | **Updated**: 2026-09-17
> **Owner**: Chat Product Team

---

## 1. Journey Index

| ID | Journey | Capabilities |
|---|---|---|
| CHAT-J01 | Find a person and send the first message | C01-C04 |
| CHAT-J02 | Daily Direct messaging | C04-C05, C08 |
| CHAT-J03 | Send rich media and a recorded voice message | C06-C07 |
| CHAT-J04 | Create and manage a group | C05, C08-C09 |
| CHAT-J05 | Complete live one-to-one voice and video calls | C10 |
| CHAT-J06 | Continue the same Chat lifecycle on Mobile | C01-C10 |
| CHAT-J07 | Continue across disconnect, device, recovery, and Station changes | C04-C11 |
| CHAT-J08 | Product release regression | C01-C11 |

## 2. CHAT-J01: Find A Person To First Message

Start: Alice and Bob have previously authenticated accounts on supported
native clients.

1. Cold launch resumes a restorable account directly. A PIN-protected account
   asks only for its PIN; a sessionless or revoked account requests provider
   authentication.
2. Alice opens Chat and chooses Find People.
3. Alice searches by local name/PTID or exact federated handle.
4. Results show stable identity, a human-readable Home Station name,
   trust/resolution state, and whether the person is self, already a friend,
   pending, or available. Canonical PTID, Station peer ID, handle, and
   Federation ID stay in an expandable copyable details surface.
5. Alice sends one friend request. Duplicate actions remain idempotent.
6. Bob sees the request, accepts or rejects it, and Alice observes the result.
   Repeated attempts for one counterparty PTID render as one selectable person
   row with current state and total attempt count; terminal history remains
   selectable without fabricating friendship.
7. On acceptance, both clients show one contact.
8. Alice selects Message. Chat opens the existing Direct conversation or
   creates exactly one conversation.
9. Alice sends unique text; Bob sees exact plaintext and replies.

Success: both clients show the same relationship, conversation identity,
message identities, ordering, and plaintext.

Recovery:

- Search failure preserves the query and provides retry.
- Relationship failure remains visible and does not invent friendship.
- Conversation creation failure keeps the selected peer and provides inline
  retry instead of returning to an empty Chat surface.
- A repeated click or delayed response cannot create duplicate relationships
  or conversations.

## 3. CHAT-J02: Daily Direct Messaging

1. Reopen an existing Direct conversation from the conversation list.
2. Load the newest durable page and preserve an older-history scroll anchor.
3. Send text and observe queued, submitting/retrying, accepted, delivered, read,
   or failed-actionable state without false promotion.
4. Receive messages while active, while viewing older history, and while the
   recipient is offline.
5. Entering Chat may acknowledge the aggregate first-level navigation badge,
   but each unread conversation row retains its own unread count until that
   conversation is opened and read.
6. The active transcript renders each newly received message without manual
   reload, and its conversation row immediately projects that same latest
   message and timestamp.
7. Retry an actionable failure without changing logical message identity.
8. Restart the client and Station at defined boundaries.
9. Restore the same conversation, draft, message order, unread/read state,
   latest-message preview, and history.
10. Read the peer and authoritative Station by human-readable names; raw PTID,
    Station peer ID, and Federation ID remain behind expandable technical
    details. Presence is shown only from an authoritative snapshot/event and
    degrades to unavailable rather than guessing online or offline.
11. Select a built-in or local background and see it immediately. A local file
    uploads and persists asynchronously; failure rolls the preview back and
    preserves an explicit retry action.
12. Search the active canonical conversation for known durable message text,
    clear the query from the input-owned suffix, and jump to the exact result.
13. Clear visible history and restore it within 24 hours; both transitions
    update all local projections without a false action-failed state.

Success: no accepted message is lost or duplicated and every terminal state is
truthful and actionable.

### CHAT-J02 Reported UX Contract

```yaml
surface: desktop.chat.direct
scenario: truthful identity, responsive settings, durable search, and bounded history restore
given:
  - an existing Direct conversation with durable plaintext and authoritative Station metadata
  - an authenticated peer whose presence may be online, offline, or unavailable
when:
  - the user opens the conversation and Details
  - the user selects a local background
  - the user searches for known message text
  - the user clears and restores visible history within 24 hours
then:
  - human-readable names lead and raw identifiers remain expandable
  - presence comes from Station snapshot or realtime events
  - the local background preview appears before upload finishes
  - search reads the canonical local message projection and finds the message
  - restore removes the clear marker and reloads the same durable history
visual_invariants:
  - the search clear control remains inside the input suffix boundary
  - background preview does not resize or remount the conversation pane
forbidden:
  - raw Station peer ID as primary metadata
  - guessed presence
  - waiting for upload before local preview
  - legacy session arrays as message-search authority
  - treating accepted clear or restore commands as failed because refresh lags
evidence:
  - native interaction trace
  - owner-layer unit and contract assertions
  - before and after screenshots
```

## 4. CHAT-J03: Rich Media And Recorded Voice

### Attachments

1. Select image/file content or confirm a screenshot capture and see an
   explicit staged/uploading/failed/ready draft.
2. Send text plus attachment or attachment-only content.
3. The receiver sees the exact media metadata and opens byte-identical content.
4. Interrupted upload/download resumes from durable checkpoints.
5. Restart and fresh recovery preserve entitled attachment access.

Screenshot capture keeps the Desktop window geometry and rendered layout
stable before, during, and after the system selection UI. Hiding and restoring
the window must not produce a visible resize or scale flash.

### Recorded Voice

1. Start microphone capture after explicit permission.
2. See recording duration and a clear stop/cancel boundary.
3. Preview or discard the local recording before durable send.
4. Send as encrypted voice content with persisted duration.
5. The receiver sees duration, transfer state, playback progress, seek, and
   retry controls.
6. Offline delivery, interrupted transfer, restart, and recovery retain exact
   audio bytes and metadata.

Success: the receiver plays the intended voice message; a resumable upload is
never misrepresented as live voice.

## 5. CHAT-J04: Group Lifecycle

1. Create a group from eligible contacts and see a pending state until the
   authoritative Group projection is committed.
2. Send and receive text, attachments, and voice messages.
3. Reply, edit, retract, react, pin, read, and type under the same ordering and
   permission semantics as Direct.
4. A successfully committed thread reply stays successful in the UI, updates
   the root reply count, and appears in both participants' thread panels and
   main-thread summaries without manual refresh.
5. Add and remove members/devices; retained members continue after the MLS
   transition and removed members receive no future content.
6. Rename, change roles/owner, leave, or dissolve through Conversation-owned
   commands.
7. Restart all participants and preserve entitled history and terminal group
   state.

Success: membership, MLS epoch, visible history, and permissions converge for
all active participants without a legacy group owner.

## 6. CHAT-J05: Live One-To-One Voice And Video

1. Alice starts an audio or video call from an active Direct conversation.
2. Alice sees permission checking then outgoing ringing.
3. Bob receives one incoming call surface across active devices.
4. Bob accepts or rejects. An unanswered call ends after the shared timeout.
5. On acceptance, both clients establish WebRTC media through direct ICE or
   TURN fallback.
6. Audio calls prove audible bidirectional media. Video calls additionally
   prove local preview, remote video, camera toggle, and camera-device changes.
7. Mute and input-device changes remain local controls with visible state.
8. A transient network failure enters reconnecting and either recovers or ends
   with an actionable reason.
9. Either side ends the call and both release media, peer, timer, and signaling
   resources.

Success: both users exchange the requested audio/video media and return to the
same Chat conversation while text messaging remains available.

## 7. CHAT-J06: Mobile Parity

Repeat CHAT-J01 through CHAT-J05 on Mobile with platform-native permission,
background/resume, safe-area, keyboard, microphone, audio-route, and lifecycle
behavior. Mobile may render controls differently but may not weaken identity,
message, retry, recovery, or receiver-visible semantics.

## 8. CHAT-J07: Continuity

Run the supported Direct, group, rich-media, recorded-voice, and live-call
flows across:

- receiver offline and reconnect;
- client restart and Station restart;
- one actor with two active devices and one revoked device;
- fresh-install recovery;
- same-Station and cross-Station users.

Success: shared authority remains ordered, device-local private state remains
isolated, and every degradation is visible without silent fallback.

## 9. CHAT-J08: Release Regression

The release journey executes the complete current-source matrix on required
Desktop and Mobile runtime cells, verifies durable readback and privacy
boundaries, and proves cleanup. It cannot be replaced by accumulated historical
passes from different commits.
