# Group Chat Lifecycle — Business Source Of Truth

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-04 | **Updated**: 2026-07-04
> **Owner**: Client Architecture Team
> **Module**: `apps/station/app/subserver/group_chat/`, `model/domain/chat/group_chat.proto`, `model/domain/realtime/event.proto`, `apps/desktop/src/store/socialChat.ts`

---

## 1. Document Scope

This document defines the business source of truth for Peers-Touch group chat lifecycle:

- group creation, membership, invitation, join, leave, removal, ownership transfer, and dissolution;
- group message send, recall, edit, delete, read, search, and history visibility;
- realtime lifecycle events and offline recovery rules;
- Sender Keys lifecycle coupling with membership changes;
- Station, client runtime, local crypto, and UI projection ownership.

This document does not define:

- friend chat ratchet internals; see `docs/architecture/encryption/chat-ratchet-upgrade.md`;
- group message ciphertext internals; see `docs/architecture/encryption/group-sender-keys.md`;
- the unified SSE transport contract; see `docs/architecture/realtime/event-stream.md`;
- Desktop or Mobile visual layout; see `docs/client/chat/chat-ux-contract.md`.

## 2. Core Principles

1. **Station owns group business truth.** Group existence, membership, role, settings, message rows, mutation rows, and lifecycle audit state are Station-owned.
2. **Model owns cross-runtime contracts.** Group, member, invitation, message, mutation, and realtime event schemas live in `model/domain/`.
3. **Clients own decrypted projection, not authority.** Desktop and Mobile can cache, decrypt, index, and render group messages, but they must not invent membership or message truth.
4. **Sender Keys follow membership authority.** Clients hold key material, but Station membership events define when clients must distribute, rotate, or stop distributing Sender Keys.
5. **History visibility is a business contract.** Joined, removed, left, and dissolved states must say whether historical rows remain visible and whether ciphertext is decryptable.
6. **Lifecycle events are repair signals, not the only truth.** Missing realtime events must be recoverable through cold sync and deterministic Station state.

## 3. Source Of Truth And Ownership

| Capability | Truth Owner | Client Responsibility | Must Not Happen |
| --- | --- | --- | --- |
| Group row and lifecycle state | Station `group_chat` | Project group list/detail | UI invents dissolved/active state without Station source |
| Membership and roles | Station `group_chat_members` | Cache member projection, enforce UX affordances | Client-side role checks as the only authorization |
| Invitations | Station `group_chat_invitations` | Display pending/accepted/rejected state | Join without Station invitation or public policy |
| Message rows | Station `group_chat_messages` | Decrypt, render, local search index | Station stores new plaintext body for E2EE groups |
| Message body plaintext | Sender/receiver devices | Encrypt/decrypt/index locally | Station decodes or transforms encrypted payload |
| Sender Keys | Client local crypto store | Distribute/consume/rotate key material | Station stores Sender Key chain keys |
| Realtime delivery | Station event bus | Resume, reconcile, cold sync | Feature-specific chat event streams |
| Presence | Station presence subserver | Observe `PresenceFlip`, retry pending SKDM | Chat subservers own presence state |

## 4. Group Lifecycle State Machine

Target lifecycle:

```text
draft/local-composer
  -> active
  -> dissolved

active
  -> active(member_added)
  -> active(member_left)
  -> active(member_removed)
  -> active(member_updated)
  -> active(owner_transferred)
  -> dissolved
```

Station must persist enough state to answer:

- Is this group active or dissolved?
- Who is currently a member?
- What role and moderation state does each member have?
- What membership epoch produced a message?
- What history is visible to a current, former, or newly added member?

Current implementation note:

- The current Station code deletes group state on dissolution. That is not sufficient for a WeChat/Telegram-grade lifecycle because it cannot support durable group history, audit, or "group dissolved but old members can still view history" semantics.

## 5. Membership Lifecycle

Target member lifecycle:

```text
not_member
  -> invited
  -> joined
  -> left

joined
  -> removed
  -> left
  -> muted/unmuted
  -> role_changed
```

### 5.1 Create Group

Contract:

- Creator becomes `OWNER`.
- Initial members must have a defined authorization mode:
  - direct-add by creator is allowed only if product policy says creator can add these actors without acceptance;
  - otherwise creation must create invitations and wait for acceptance.
- A group starts at `membership_epoch = 1`.
- For E2EE groups, every sender chain created under this epoch must bind to `(group_ulid, sender_did, sender_key_id, membership_epoch)`.

Current implementation:

- `CreateGroup` creates owner membership.
- `initial_member_dids` are directly added.
- There is no persisted `membership_epoch`.

### 5.2 Invite

Contract:

- Inviter must be a current member.
- Product policy must define whether any member can invite or only owner/admin can invite.
- Invitation must include:
  - `group_ulid`
  - `inviter_did`
  - `invitee_did`
  - `status`
  - `expire_at`
  - `created_at`
- Invitation must be single-use.

Current implementation:

- Inviter must be a member.
- Invitation is bound to `invitee_did`.
- `expire_at` exists in proto but is not enforced in the observed service path.
- Invitation status is updated on accept, but join currently does not require an invitation.

### 5.3 Join

Contract:

- Private groups: join must require a valid pending invitation for the authenticated actor.
- Public groups: join may omit invitation only if `GroupVisibility.PUBLIC` and group policy allows open join.
- Join must fail if:
  - invitation is missing for private group;
  - invitation does not belong to actor;
  - invitation is expired, accepted, rejected, revoked, or group mismatched;
  - group is dissolved;
  - max member count is reached.
- Successful join increments `membership_epoch`.
- The new member can decrypt only messages for epochs they are entitled to.

Current implementation gap:

- `JoinGroupRequest.invitation_ulid` is optional and `JoinByActor` adds the actor when it is empty.
- This is not industrial-grade for private groups because any authenticated actor who knows `group_ulid` can attempt direct join.

### 5.4 Leave

Contract:

- Non-owner members may leave.
- Owner must transfer ownership or dissolve the group before leaving.
- Leave increments `membership_epoch`.
- Remaining members must rotate Sender Keys before sending post-leave messages.
- Former member history policy must be explicit:
  - recommended: keep local readable history through leave time, stop new delivery and post-leave key distribution.

Current implementation:

- Owner cannot leave.
- Member row is removed.
- `GroupMembershipChange.LEFT` is published to remaining members.
- There is no membership epoch.

### 5.5 Remove Member

Contract:

- Owner/admin can remove lower-privilege members according to role hierarchy.
- Removed member must stop receiving new group message events.
- Remaining members must rotate Sender Keys before post-removal sends.
- Removed member history policy must be explicit:
  - recommended: retain history visible up to removal time unless legal/moderation policy requires revoke; future messages unavailable.

Current implementation:

- Owner/admin role hierarchy is partially enforced.
- Owner cannot be removed.
- Member row is removed.
- `GroupMembershipChange.REMOVED` is published.
- Sender Key rotation is best-effort from client-side member refresh, not epoch-enforced by Station.

### 5.6 Transfer Ownership

Contract:

- Only owner may transfer ownership.
- Target must be a current non-owner member.
- Transfer does not itself require Sender Key rotation, unless product policy treats owner role as encryption-policy authority.
- Event must reach all current members.

Current implementation:

- Owner-only transfer is enforced.
- `GroupMembershipChange.TRANSFERRED` is published.

### 5.7 Dissolve Group

Contract:

- Only owner may dissolve.
- Dissolution should be a soft lifecycle transition, not immediate physical deletion, if the product promises members can keep group history.
- Recommended target behavior:
  - mark group `dissolved_at`;
  - stop new messages, invitations, joins, membership changes except local settings;
  - retain message rows for members entitled to history;
  - publish `GroupMembershipChange.DISSOLVED` to all current members;
  - clients render "group dissolved" and keep read-only history.

Current implementation gap:

- Station currently hard-deletes group, members, messages, settings, invitations, and offline records.
- This prevents durable history and audit after dissolution.

## 6. Message Lifecycle

### 6.1 Send

Contract:

- Sender must be current member and not muted.
- E2EE group sends must set `encrypted_payload` and must not set plaintext `content`.
- Station persists opaque ciphertext and routing metadata only.
- Message must bind to current `membership_epoch`; if client sends with stale epoch, Station rejects with `GROUP_MEMBERSHIP_EPOCH_STALE`.
- On success, Station fans out a message event to current eligible recipients.

Current implementation:

- Station rejects plaintext `content` for group sends.
- Sender membership/mute gates exist.
- There is no send-time membership epoch check.

### 6.2 Receive And Decrypt

Contract:

- Client receives group message event or cold-syncs group messages.
- Client decrypts using `(group_ulid, sender_did, sender_key_id, counter, membership_epoch)`.
- Missing Sender Key must surface as a temporary state only when the user is entitled to that epoch.
- If the user joined after the message epoch, UI must show "message sent before you joined" instead of waiting forever.

Current implementation:

- Missing Sender Key surfaces as `[Waiting for sender key...]`.
- Late SKDM install triggers re-decrypt of stuck messages.
- UI does not yet distinguish "not entitled to pre-join history" from "waiting for key".

### 6.3 Recall

Contract:

- Original sender can recall within mutation window.
- Recall preserves the row as a tombstone.
- For E2EE messages, recall clears encrypted body.
- Mutation event reaches affected recipients.

Current implementation:

- Membership gate and sender/window gate exist.
- Realtime `MessageMutation.RECALL` exists.

### 6.4 Edit

Contract:

- Original sender can edit within mutation window.
- E2EE edit must produce a fresh ciphertext at the current sender chain counter.
- Receivers prefer `new_ciphertext` over plaintext.
- Event ordering follows parent `StreamEvent.event_id`.

Current implementation:

- Edit path accepts `new_encrypted_payload`.
- Current client/server coverage needs more E2E evidence for group encrypted edit.

### 6.5 Delete

Contract:

- Sender may delete own message.
- Admin/owner may delete for moderation.
- Delete removes the row from visible projection or marks it hidden depending on audit policy.
- Moderation delete must not reveal plaintext to Station for E2EE messages.

Current implementation:

- Sender delete exists.
- Admin/owner override exists in application layer.
- Audit/retention policy is not documented.

### 6.6 Read And Per-User Settings

Contract:

- Read state, pinned, muted, alert, nickname, background, and cleared history cursor are per-actor projection settings.
- `cleared_at_unix_ms` hides local visible history for that actor but does not delete Station truth.

Current implementation:

- Per-user group settings exist, including `cleared_at_unix_ms`.
- Settings change emits `ConversationSettingsChanged`.

## 7. History Visibility Contract

Target product semantics:

| Actor State | Group List | History Rows | Decryption | New Events |
| --- | --- | --- | --- | --- |
| Current member | Visible | Visible subject to clear cursor | Entitled epochs decrypt | Receives |
| Newly joined member | Visible from join | Product-defined; recommended no pre-join plaintext | Only join epoch and later | Receives after join |
| Left member | Hidden or archived | Recommended local/archive history until leave | Existing local keys may decrypt old history | No new messages |
| Removed member | Hidden or archived | Recommended history until removal unless policy revokes | Existing local keys may decrypt old history | No new messages |
| Dissolved group member | Read-only archived | Visible to entitled members | Existing entitled ciphertext decrypts | Only lifecycle/settings sync |
| Non-member stranger | Not visible | Not visible | No keys | No events |

This table must become a product-reviewed contract before implementation is considered complete.

## 8. Realtime Event Contract

Station emits one canonical SSE stream per device-window. Group lifecycle uses these event families:

| Operation | Station State Change | Realtime Event | Recipients | Client Action |
| --- | --- | --- | --- | --- |
| Send message | Add message row | `MessageEnvelope` or group message equivalent | Current members | Merge/decrypt message |
| Recall/edit/delete | Mutate message row | `MessageMutation` | Current entitled members | Apply mutation |
| Join/add member | Add member, bump epoch | `GroupMembershipChange.ADDED` | Current/new members | Refresh group/members, rotate/distribute keys |
| Leave | Remove member, bump epoch | `GroupMembershipChange.LEFT` | Remaining members | Refresh members, rotate keys |
| Remove member | Remove member, bump epoch | `GroupMembershipChange.REMOVED` | Previous + remaining members as policy allows | Refresh/archive, rotate keys |
| Role/mute change | Update member | `GroupMembershipChange.UPDATED` | Current members | Refresh member projection |
| Transfer owner | Update owner/roles | `GroupMembershipChange.TRANSFERRED` | Current members | Refresh group/member projection |
| Dissolve | Mark dissolved | `GroupMembershipChange.DISSOLVED` | Current members | Archive read-only group |
| Settings change | Update actor setting | `ConversationSettingsChanged.GROUP` | Actor's devices | Refresh settings |
| Missed stream | None | `Resync` | Device | Cold sync groups/messages/settings |

Target event additions:

- `membership_epoch`
- `operator_did`
- `affected_actor_did`
- `history_policy`
- `requires_sender_key_rotation`
- `dissolved_at_unix_ms`

## 9. Sender Keys And Membership Epoch

Target invariant:

```text
membership change -> epoch bump -> sender chain rotation before next post-change send
```

Rules:

1. Every group message is associated with the membership epoch observed at send time.
2. Every Sender Key chain is associated with a membership epoch or a monotonic sender key generation caused by that epoch.
3. If Station receives a message with stale epoch, it rejects the send.
4. Client handles stale epoch by refreshing members, rotating local sender chain, clearing SKDM sent ledger, distributing SKDM to current members, and retrying once.
5. New members never receive old epoch Sender Keys by default.
6. Removed/left members never receive new epoch Sender Keys.

Current implementation:

- Sender Keys and SKDM distribution exist.
- Distribution is send-driven and ledger-deduped.
- Pending SKDM retry exists on presence flip.
- There is no Station-owned membership epoch or stale-send rejection.

## 10. Offline And Inactive User Recovery

Target behavior:

1. Realtime stream resumes by `Last-Event-ID`.
2. If cursor is too old, Station emits `Resync`.
3. Client cold-syncs:
   - group list;
   - group members;
   - group messages;
   - settings;
   - pending SKDM friend control messages.
4. Client installs any SKDM first, then decrypts group messages in sender-chain order.
5. Messages from epochs the actor is not entitled to must render as policy placeholders, not indefinite key-wait states.

Current implementation:

- Event stream has `Resync`.
- Desktop performs social projection refresh and group cold sync.
- SKDM friend control messages are processed when friend sessions load.
- Recovery is not yet specified as a single group lifecycle acceptance flow.

## 11. Authorization Matrix

Target matrix:

| Action | Owner | Admin | Member | Invited Actor | Stranger |
| --- | --- | --- | --- | --- | --- |
| Create group | yes | n/a | n/a | n/a | authenticated only |
| Invite member | yes | policy | policy | no | no |
| Accept invitation | no | no | no | only own pending invite | no |
| Join public group | policy | policy | policy | policy | if public policy allows |
| Send message | yes | yes | yes if not muted | no | no |
| Recall own message | yes | yes | yes | no | no |
| Edit own message | yes | yes | yes | no | no |
| Delete own message | yes | yes | yes | no | no |
| Moderation delete | yes | yes for lower roles | no | no | no |
| Remove member | yes | lower roles only | no | no | no |
| Update role/mute | yes | lower roles only, no role promote | no | no | no |
| Transfer ownership | yes | no | no | no | no |
| Dissolve group | yes | no | no | no | no |

Industrial-grade requirement:

- Every `yes` must be enforced on Station.
- Client UI may hide unavailable actions, but hidden UI is not security.

## 12. Industrial-Grade Review Of Current Implementation

Current implementation is a meaningful foundation but not yet WeChat/Telegram-grade.

### 12.1 Strong Areas

- Unified realtime stream exists and is the correct architecture for text/event delivery.
- Group send rejects plaintext bodies for Sender-Keys-capable clients.
- Sender Keys wire contract exists in proto and Desktop crypto paths.
- Message mutation paths exist for recall/edit/delete.
- Role hierarchy exists for member removal/update.
- Desktop projection direction is aligned with Station truth and runtime reconcile.

### 12.2 Blocking Gaps

1. **Join authorization gap.** Private group join can omit invitation. This must be closed before claiming group lifecycle security.
2. **No membership epoch.** Sender Key rotation cannot be strictly bound to membership changes.
3. **Dissolve is hard delete.** This conflicts with durable history, audit, and post-dissolution read-only archives.
4. **History policy is unspecified.** Joined/left/removed/dissolved visibility rules are not product-contract complete.
5. **SKDM delivery is best-effort.** It is send-driven plus pending retry, not a complete membership-change key distribution protocol.
6. **No explicit stale-send retry.** A client can send against a stale member snapshot without Station rejecting by epoch.
7. **No group lifecycle audit model.** Current events notify clients but are not a durable business audit ledger.
8. **No complete inactive-user acceptance suite.** Recovery from missed events, late SKDM, and historical entitlement is not tested end to end.
9. **Moderation retention is undefined.** Delete vs tombstone vs audit retention needs a formal policy.
10. **Large-group scaling is unproven.** Sender Keys O(n^2) distribution at creation/change needs batching/backpressure strategy.

### 12.3 Industrial-Grade Bar

To benchmark against WeChat/Telegram-class IM, the capability must satisfy:

- strict Station-side authorization for every lifecycle command;
- durable lifecycle state and audit trail;
- recoverable event stream with cold-sync repair;
- explicit history entitlement semantics;
- membership epoch and key rotation correctness;
- multi-device key distribution semantics;
- clear UI states for waiting key, not entitled, deleted, recalled, dissolved, and removed;
- load/backpressure design for large groups;
- repeatable acceptance tests for two users, inactive user recovery, late join, kick, leave, dissolve, and multi-device.

## 13. Required Execution Backlog

P0:

- Require valid invitation for private group join.
- Add tests proving direct join is rejected.
- Add product decision for direct-add initial members.
- Document and implement history visibility policy.

P1:

- Add `membership_epoch` to group/member/message/event contracts.
- Reject stale group sends and implement client retry.
- Bind Sender Key generation to membership epoch.
- Convert dissolution to soft archive if history retention is required.

P2:

- Add group lifecycle audit table/events.
- Add SKDM batching and retry queue.
- Add inactive-user recovery acceptance tests.
- Add UI states for pre-join history and dissolved read-only groups.

P3:

- Multi-device group key catch-up.
- Large-group delivery backpressure and observability.
- Admin moderation retention and export policy.

## 14. Verification Matrix

Before this lifecycle is considered complete:

| Scenario | Required Evidence |
| --- | --- |
| Stranger direct join private group | Station test rejects |
| Invite acceptance | Only invitee can join, once, before expiry |
| Late join | Cannot decrypt pre-join messages; can decrypt post-join messages |
| Member removal | Removed member receives no new events and no new SKDM |
| Member leave | Remaining members rotate keys before next send |
| Owner dissolve | Group becomes read-only archive or documented hard-delete policy applies |
| Inactive recovery | Resync + cold sync + SKDM install + decrypt succeeds |
| Recall/edit/delete | Mutation events converge across devices |
| Stale epoch send | Station rejects; client refreshes and retries |
| Multi-device | New device receives current keys without exposing old unauthorized history |

