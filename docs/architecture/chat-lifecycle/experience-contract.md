# Chat Lifecycle - Experience Contract

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-16 | **Updated**: 2026-09-22
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
| CHAT-J06 | Continue the same Chat lifecycle on Mobile | C01-C10, C12 |
| CHAT-J07 | Continue across disconnect, device, recovery, and Station changes | C04-C12 |
| CHAT-J08 | Product release regression | C01-C13 |
| CHAT-J09 | Complete group live voice and video calls | C09, C12 |
| CHAT-J10 | Same-actor multi-device messaging convergence | C04-C05, C08, C11, C13 |
| CHAT-J11 | Cross-device call resolution | C10, C11, C13 |

### 1.1 CCU Journey Crosswalk

CCU 不创建第二套用户 Journey。以下 ID 是 Desktop/Mobile 混合客户端执行视角，
每一项都组合并加强既有 Chat Journey：

| ID | Mixed-client outcome | Governing Chat Journey |
|---|---|---|
| CCU-J01 | Desktop 与 Mobile 双向打开/复用同一 Direct，并交换相同 identity 和 exact plaintext | CHAT-J01, CHAT-J02 |
| CCU-J02 | 混合客户端完成 Group 创建、成员/角色/Owner 变更、消息和 MLS epoch 收敛 | CHAT-J04 |
| CCU-J03 | 混合客户端完成 reply/thread/edit/retract/reaction/pin/read/typing，并在 duplicate/restart 后收敛 | CHAT-J02, CHAT-J04 |
| CCU-J04 | 混合客户端交换图片、文件和语音附件，并验证 byte-identical readback 与恢复 | CHAT-J03 |
| CCU-J05 | 离线、重连、进程重启、actor/Station/endpoint 切换和 fresh-device recovery 后保持同一 canonical projection | CHAT-J07 |
| CCU-J06 | 任一上述 Journey 的生产链路均无 legacy owner、route、type、store 或 runtime trace | CHAT-J08 |
| CCU-J07 | 同一 actor 的 Desktop/Mobile sender companion 与 read cursor 单调收敛 | CHAT-J10 |
| CCU-J08 | 同一被叫 actor 的 Desktop/Mobile 来电由一个 `call_id` 原子决胜，loser 进入 `handled_elsewhere` | CHAT-J11 |

每个 CCU Journey 都必须双向运行适用的 sender/receiver 组合；同平台或单方向
PASS 不能替代 mixed-client 结果。

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

Repeat CHAT-J01 through CHAT-J05 and CHAT-J09 on Mobile with platform-native
permission, background/resume, safe-area, keyboard, microphone, audio-route,
camera, and lifecycle behavior. Mobile may render controls differently but may
not weaken identity, message, retry, recovery, membership, media, or
receiver-visible semantics.

## 8. CHAT-J07: Continuity

Run the supported Direct, group, rich-media, recorded-voice, one-to-one call,
and group-call flows across:

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
boundaries, and proves cleanup for `CHAT-C01` through `CHAT-C13`. It cannot be
replaced by accumulated historical passes from different commits.

## 10. CHAT-J09: Group Live Voice And Video

Start: an authoritative Group conversation has at least three eligible active
members.

1. A member starts an audio or video call from the Group conversation.
2. Eligible members receive one group-call invitation per actor, while removed,
   blocked, or revoked members receive none.
3. Each member independently joins, declines, or joins late without restarting
   the room or duplicating participant identity.
4. Joined members observe the same participant roster, speaking state, mute
   state, camera state, and call termination state.
5. Video calls render stable participant tiles, active-speaker indication,
   local preview, camera-off state, and bounded overflow for larger groups.
6. Membership or device revocation during the call removes future media and
   signaling authority without exposing content to the removed endpoint.
7. A transient network or Station interruption enters reconnecting and either
   restores the same room identity or ends with a visible actionable reason.
8. Members leave independently; the final authorized end releases client media,
   SFU participation, timers, and call projections.

Success: three or more native clients exchange the requested group audio/video,
agree on participant and terminal state, and return to the same Group
conversation.

Failure and recovery:

- Permission denial, capacity, membership, network, and media failures are
  distinct visible states.
- A failed join preserves the Group conversation and provides retry.
- Group calls never fall back to an unbounded peer-to-peer mesh.

## 11. CHAT-J10: Same-Actor Multi-Device Messaging Convergence

Start: the same actor (Alice) is simultaneously logged in on Desktop and
Mobile, each with an active authenticated endpoint against the same or
different Stations. Bob is on a separate client.

1. Alice sends a text message to Bob from Desktop.
2. Alice's Mobile receives sender companion delivery with the same
   `event_id` / `message_id` and displays exactly one message bubble in the
   same conversation, without manual refresh or page mount.
3. Bob's client receives the message and advances delivery state.
4. Bob reads the message; Conversation Authority advances the actor-scoped
   read cursor.
5. Alice's Desktop and Mobile both reflect the updated read state
   monotonically; neither device regresses unread count or read cursor.
6. Alice sends a message from Mobile. Alice's Desktop receives sender
   companion delivery with the same `event_id` / `message_id` and displays
   one bubble.
7. Bob reads that message; both of Alice's devices again converge read
   state monotonically.
8. Alice's Mobile goes offline. Bob sends messages. Alice's Desktop
   receives them immediately. When Mobile reconnects, it recovers the same
   messages from its durable queue without duplication.
9. A new device registered after event commit does not receive historical
   ciphertext; it recovers entitled history through Recovery, not replay.
10. A revoked device receives no future queue items.

Success: every message appears exactly once on every active device of every
actor with the same identity; read state advances monotonically across the
actor's devices; per-device delivery and ACK facts remain independent.

Failure and recovery:

- Offline active device recovers from durable queue on reconnect; no
  message loss or duplication.
- New device uses Recovery to restore entitled history; it does not trigger
  re-encryption or replay of per-device ciphertext.
- Revoked device is excluded from future delivery; revoke is fail-closed.
- Concurrent send from both devices produces two distinct `command_id` /
  `event_id` pairs; each device sees both messages exactly once.
- Network partition between companion devices does not block the sending
  device or the recipient; convergence happens on reconnect.

## 12. CHAT-J11: Cross-Device Call Resolution

Start: Alice calls Bob. Bob is simultaneously logged in on Desktop and Mobile,
each with an active authenticated endpoint.

1. Alice initiates a voice or video call from an active Direct conversation.
2. Bob's Desktop and Mobile both receive ringing state for the same
   `call_id`. Each device shows one incoming call surface, not independent
   call attempts.
3. Bob accepts the call on Mobile.
4. The Realtime control-plane owner atomically resolves Mobile as the
   winning endpoint (first-terminal-action-wins).
5. Bob's Mobile enters `active_here` and establishes the media session with
   Alice.
6. Bob's Desktop immediately stops ringing, releases ring timer and
   temporary media resources, and enters `handled_elsewhere`. It does not
   establish a second PeerConnection or media session.
7. Alice observes exactly one accepted terminal result; she does not see
   conflicting accept/reject signals.
8. A concurrent late accept or reject from Desktop arrives at the
   control-plane owner and receives `CALL_ALREADY_HANDLED`; it does not
   alter the winning endpoint or create a second session.
9. If Bob explicitly rejects on Desktop before any device accepts, the
   reject is an actor-level terminal action; all of Bob's devices stop
   ringing and Alice sees one rejection result.
10. Closing or minimizing the call UI on one device without explicitly
    accepting or rejecting is not a global reject; sibling devices continue
    ringing until explicit action or shared timeout.

Success: exactly one of Bob's devices handles the call; all other devices
converge to `handled_elsewhere` or the shared terminal state; Alice sees one
coherent outcome; no duplicate media sessions exist at any point.

Failure and recovery:

- Duplicate signal, SSE reconnect, or late signal replay does not restart
  ringing or change the winning endpoint.
- Network partition during resolution: the control-plane owner holds the
  atomic decision; a partitioned device that missed the resolution
  discovers the outcome on reconnect and transitions to
  `handled_elsewhere` or the terminal state.
- If no device responds before the shared timeout, the call ends with an
  unanswered terminal state on all devices and for the caller.
- Station holds only short-lived control-plane resolution metadata
  (`callee_actor`, `call_id`, `winning_device`, `terminal_action`) with
  TTL; it never stores or parses SDP, ICE candidates, media keys, or
  sealed signaling plaintext.
