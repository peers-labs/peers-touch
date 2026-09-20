# AO-D10 Conversation Member Authority

**Status**: accepted
**Date**: 2026-09-18
**Owner**: Conversation

## Scope

This decision adds canonical target-member administration and atomic ownership
transfer to the existing Conversation authority. It does not change Social,
OAuth, Access Gate, Mobile callers, or the legacy `/group-chat/*` routes.

`/conversation/member/settings` remains actor-local preference state. It must
not mutate another member's authority role, send permission, or mute deadline.

## Canonical Commands

Conversation exposes two typed client routes:

```text
POST /conversation/member/update
POST /conversation/ownership/transfer
```

Both requests carry one exact, deterministic command identity:

- `command_id`;
- `conversation_id`;
- authenticated operator PTID and device ID;
- target member PTID;
- authority Station and authority epoch;
- observed authority sequence and event hash;
- observed membership and MLS epochs;
- client timestamp and command deadline.

Member update additionally carries an optional `member|admin` role patch and/or
an optional mute patch. `muted=true` may carry `muted_until`; no deadline means
an indefinite authority mute. `muted=false` clears `muted_until`.

The same command ID with the same deterministic bytes replays the original
result. The same command ID with different bytes is a command conflict.

## Authorization

- The operator must be an active member endpoint.
- Only the owner may promote or demote a member.
- An admin may mute or unmute only an ordinary member.
- The owner may mute or unmute an admin or ordinary member.
- The owner row cannot be changed through member update.
- The target must be an active Conversation member.
- Only the current owner may transfer ownership.
- The transfer target must be an active non-owner member.

Expired command deadlines and expired mute deadlines fail before mutation.
Stale authority sequence/hash, authority epoch, membership epoch, or MLS epoch
fail before mutation.

## Atomic Owner Transfer

Owner transfer is one aggregate transition and one authority event:

```text
old owner role -> admin
new owner role -> owner
new owner mute -> false with no deadline
Conversation.owner_ptid -> new owner
membership_epoch -> membership_epoch + 1
MLS epoch -> unchanged
authority sequence/hash -> next committed event
```

The candidate aggregate is validated for exactly one active owner before any
state is persisted. Aggregate state, member rows, event, command receipt,
device deliveries, Federation outbox rows, and follower projection grants are
committed in the existing Conversation unit of work. There is no externally
observable two-step state and no compatibility path.

## Event And Projection

Both operations emit `ConversationMemberAuthorityCommittedFact` containing:

- the operation and target;
- the exact applied role/mute fields;
- previous and resulting owner for transfer;
- from/to membership epoch;
- the complete hashed `ConversationAuthoritySnapshot`.

The snapshot includes every active member's role, mute state, and optional mute
deadline. Device delivery and Station follower projection consume the same
event bytes. Member administration changes membership authorization state, so
membership epoch advances exactly once; the MLS leaf set is unchanged, so MLS
epoch does not advance and no MLS commit is fabricated. Group state therefore
requires non-zero epochs with `membership_epoch >= mls_epoch`; a later MLS
membership transition advances both epochs once without forcing them equal.

## Stable Failures

| Condition | Stable code |
|---|---|
| operator lacks permission | `CONVERSATION_UNAUTHORIZED` |
| target is not an active member | `CONVERSATION_TARGET_NOT_MEMBER` |
| owner row is changed outside transfer | `CONVERSATION_OWNER_PROTECTED` |
| command or mute deadline expired | `CONVERSATION_COMMAND_EXPIRED` |
| observed authority head/epoch is stale | `CONVERSATION_STALE_AUTHORITY_HEAD` |
| observed membership or MLS epoch is stale | existing stale epoch codes |
| command ID reused with different bytes | `CONVERSATION_COMMAND_CONFLICT` |

## Required Proof

- proto and ownership registry identify Conversation as the only public owner;
- aggregate tests prove role/mute authorization and exact owner uniqueness;
- persistence tests prove role/mute/deadline round trips;
- UOW tests prove rollback leaves owner, roles, epochs, event, receipt, and
  deliveries unchanged;
- concurrent commands allow one winner and reject the stale competitor;
- exact replay returns the original event without another mutation;
- follower tests apply the same owner/member snapshot and reject contradictory
  owner or epoch state;
- HTTP tests prove authentication binding and stable error bodies.
