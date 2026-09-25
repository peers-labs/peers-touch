# AO-D10A Federated Member Authority Command Routing

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-18 | **Updated**: 2026-09-19
> **Owner**: Architecture Team
> **Module**: `model/domain/chat/`,
> `apps/station/app/subserver/conversation/`,
> `apps/mobile/src-tauri/src/messaging/`
> **Approval**: Owner accepted AO-D10A.1 through AO-D10A.6 on
> 2026-09-19 and authorized Mobile iOS continuation.

---

## 1. Scope

This amendment closes the cross-Station trust and delivery gap discovered
while Mobile consumed the accepted AO-D10 member-authority contract.

It preserves:

- Conversation as the only member-authority owner;
- `POST /conversation/member/update` and
  `POST /conversation/ownership/transfer` as the canonical client routes;
- one exact `ConversationMemberAuthorityCommand`;
- one committed `ConversationMemberAuthorityCommittedFact`;
- ordered Device Inbox projection as the completion truth.

It does not change member role, mute, owner-transfer, epoch, or event semantics.
It does not add a Group route, direct remote bearer call, compatibility path,
second command store, or synchronous Federation fallback.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
| --- | --- | --- | --- | --- |
| Mobile credentials and origin are pinned to the authenticated Home Station | `verified_fact` | `apps/mobile/src-tauri/src/runtime/oauth/session.rs`; `apps/mobile/src-tauri/src/messaging/transport.rs` | high | none |
| Both AO-D10 handlers reject a command whose authority Station is not the local Station | `verified_fact` | `apps/station/app/subserver/conversation/production_http.go::submitMemberAuthorityCommand` | high | none |
| `ConversationMemberAuthorityCommand` has exact authority and epoch fields but no actor-device signature | `verified_fact` | `model/domain/chat/command.proto` | high | none |
| The accepted signed remote proposal carries only `ChatCommand` | `verified_fact` | `ConversationCommandProposal.command`; `ConversationCommandProposalSigningInput` | high | none |
| The shared `AUTHORITY_COMMAND` Federation path maps only `ChatCommand` before `SubmitForwarded` | `verified_fact` | `production_federation.go::ApplyAuthorityCommand`; `forwardConversationProposal` | high | none |
| `SubmitRequest` and `ForwardedCommandRequest` already support `MemberAuthority` after mapping | `verified_fact` | `application/command/service.go` | high | proposal decoding and kind admission |
| `KindMemberAuthority` is not in `forwardableCommandKind` | `verified_fact` | `application/command/service.go::forwardableCommandKind` | high | none |
| A remote owner or admin cannot issue a later member-authority mutation through the current trusted topology | `inference` | local-route rejection plus absent signed forwarding input | high | executable two-Station negative test |

## 3. Verified Problem

The initial group owner normally talks to the authority through the same Home
Station. AO-D10 therefore works in that topology. Atomic ownership transfer can
move ownership to an actor whose Home Station is a follower. From then on:

```text
remote owner Mobile
  -> authenticated remote Home Station
  -> canonical member-authority route
  -> rejects because authority_station_peer_id != local Station
```

Calling the authority Station directly is not valid because Mobile has no
credential for that Station and may not export or reuse its Home Station bearer
credential. Forwarding the unsigned command would make the Home Station an
unverifiable authority for another actor's mutation.

This is a missing trust contract, not an implementation-only routing defect.

## 4. Accepted Decisions

### AO-D10A.1: Generalize The Existing Signed Conversation Proposal

`ConversationCommandProposal` becomes the single actor-device-signed wrapper
for both existing `ChatCommand` and `ConversationMemberAuthorityCommand`
payloads.

The current `ChatCommand command = 9` wire field remains compatible. A new
proposal payload field carries `ConversationMemberAuthorityCommand`, and
`ConversationCommandKind` gains one member-authority kind. The signing input
continues to bind:

- format version;
- Federation, Home Station, authority Station, and authority epoch;
- conversation ID and command ID;
- command kind and SHA-256 of deterministic command bytes;
- actor PTID, device ID, and signing key ID;
- creation and expiry.

The proposal does not redefine or wrap member-authority state. It only proves
who authorized the exact AO-D10 command bytes.

### AO-D10A.2: Canonical Routes Accept Local Command Or Remote Proposal

The two AO-D10 request messages become submission envelopes:

```proto
message UpdateConversationMemberRequest {
  oneof submission {
    ConversationMemberAuthorityCommand command = 1;
    ConversationCommandProposal proposal = 2;
  }
}

message TransferConversationOwnershipRequest {
  oneof submission {
    ConversationMemberAuthorityCommand command = 1;
    ConversationCommandProposal proposal = 2;
  }
}
```

Field `1` retains the current command wire identity.

- Local authority: submit the raw command.
- Remote authority: submit the signed proposal to the authenticated Home
  Station through the same capability-specific route.
- A local-authority proposal and a remote-authority raw command are rejected.
- The request action must match its route before any durable effect.

### AO-D10A.3: Home Station Uses Existing Durable Authority Forwarding

For a remote proposal, the Home Station:

1. binds authenticated actor and device to proposal and command;
2. verifies deterministic command bytes and `command_sha256`;
3. verifies the actor-device signature from the local verified identity
   projection;
4. verifies active Federation and authority public-head routing;
5. persists the existing `AUTHORITY_COMMAND` `FederatedDomainFrame`;
6. returns `accepted_for_forwarding`, never committed success.

The Home Station does not authorize role, mute, or ownership policy and does
not mutate a Conversation projection optimistically.

### AO-D10A.4: Authority Reuses The Existing Forwarded Command UOW

The authority Federation consumer decodes the proposal payload kind and:

- prepares the current Conversation authority head and endpoint routes;
- maps the exact command through `MapMemberAuthorityCommand`;
- populates `SubmitRequest.MemberAuthority`;
- admits `KindMemberAuthority` in `forwardableCommandKind`;
- calls the existing `SubmitForwarded`.

Actor signature, Home Station token claims, command hash, authority epoch,
Federation, endpoint, deadline, and current authority head are revalidated
under the authority transaction lock. AO-D10 authorization and atomic owner
transfer remain unchanged.

### AO-D10A.5: One Durable Client Command Lifecycle

The Device Messaging Engine persists member-authority command identity and
exact bytes before network dispatch. The durable command record identifies the
canonical route and payload kind without creating another business truth.

Command-result processing must decode the recorded payload kind instead of
assuming every durable Conversation command is a `ChatCommand`.

Outcomes are:

- `pending`: exact command is durable or accepted for forwarding;
- `failed`: a stable terminal code was received;
- `projected`: the ordered committed event advanced the local authority head
  to the returned event and the complete snapshot was atomically applied.

Only `projected` completes the Group store action. Command-result acceptance
alone does not patch owner, member, role, mute, or epoch state.

### AO-D10A.6: Stable Failure Semantics

| Condition | Required result |
| --- | --- |
| Authority head, membership epoch, or MLS epoch changed before dispatch | reconcile ordered inbox, expose the matching stale code, require explicit retry |
| Remote authority unavailable | durable retry/pending; no fallback route |
| Actor key missing or revoked | existing typed proposal key rejection |
| Proposal hash, identity, Station claims, or signature mismatch | terminal integrity or authorization rejection |
| Exact proposal replay | same durable result, no second mutation |
| Same command ID with different bytes | `CONVERSATION_COMMAND_CONFLICT` |
| Authority commits but local event has not arrived | `pending`, never optimistic success |
| Ordered event contradicts command or snapshot | fail closed and preserve the previous local authority head |

## 5. Runtime And Trust Topology

```text
Mobile Web
  -> typed Tauri member-authority command
Mobile Rust
  -> exact command persistence
  -> actor-device signed proposal when authority is remote
Home Station canonical AO-D10 route
  -> authentication + signature + route validation
  -> durable AUTHORITY_COMMAND Federation frame
Authority Station
  -> forwarded claim verification
  -> AO-D10 aggregate/UOW commit
  -> durable command result + committed event fan-out
Home Station Device Inbox
  -> command-result state
  -> ordered member_authority_committed snapshot
Mobile local projection
  -> projected completion
```

Allowed:

- Mobile talks only to its authenticated Home Station.
- Home Station forwards only signed exact command bytes through shared
  Federation.
- Authority remains the only business mutation owner.

Forbidden:

- Mobile bearer use against the authority Station.
- Home Station rewriting or synthesizing command identity/signature.
- Unsigned forwarding.
- Group-route fallback, dual write, optimistic owner/role patch, or a second
  member-authority result store.

## 6. Contract And Source Consequences

Required target changes:

- extend `command.proto` proposal payload and command kind;
- make the two `conversation_api.proto` requests local-or-proposal envelopes;
- regenerate Go, Rust, and TypeScript bindings;
- extend Mobile exact command persistence, dispatch, result decoding, and
  ordered readback;
- extend canonical Home Station handlers and shared Federation mapping;
- admit forwarded `KindMemberAuthority`;
- retain the same authority aggregate, event, UOW, follower projection, and
  public routes.

Target deletions:

- the temporary assumption that every AO-D10 caller is connected to the
  authority Station;
- any synchronous direct-authority Mobile path;
- any completion path that returns success before ordered projection.

## 7. Alternatives Rejected

### Direct Mobile Call To Authority Station

Rejected because the Mobile session is Home-Station scoped. Exporting,
exchanging, or reusing bearer credentials would violate MS-D17 and expand the
credential trust boundary.

### Unsigned Home Station Forwarding

Rejected because the authority could prove only which Station forwarded the
request, not which actor device authorized the exact bytes.

### New Member-Authority-Only Federation Protocol

Rejected because the existing signed Conversation proposal, forwarded claims,
durable `AUTHORITY_COMMAND` frame, result delivery, and `SubmitForwarded` UOW
already own this trust and reliability problem.

### Keep Same-Station Support And Defer Remote Owners

Rejected because ownership transfer itself can create a remote owner. A
successful atomic transfer may not leave the new owner unable to exercise the
accepted owner capability.

## 8. Architecture Gates

Source gates must prove:

- deterministic member-authority proposal signing and hash binding;
- local raw command and remote signed proposal route selection;
- Home Station auth/signature/claim rejection paths;
- one durable forwarded frame on exact replay;
- authority `SubmitForwarded` role/mute and atomic owner-transfer behavior;
- command-result decoding for member-authority payloads;
- ordered event projection before `projected`;
- zero Group fallback or direct remote bearer path.

Runtime proof remains in `W5-PROOF` and `W6A-PROOF`:

- two actors on two Home Stations;
- authority on one Station;
- ownership transferred to the remote actor;
- remote owner performs a later role or mute mutation;
- sender and receiver observe one owner, complete member snapshot, monotonic
  authority sequence/hash, membership epoch +1 per operation, and unchanged MLS
  epoch;
- restart and exact replay do not duplicate mutation.

## 9. Review Status

`ACCEPTED`.

The Owner accepted AO-D10A.1 through AO-D10A.6 on 2026-09-19. The amendment is
implementation authority for `W5-OWNER`. Architecture acceptance does not
establish source completion or runtime proof; the Task remains `in_progress`
until its implementation and source gates pass, while cross-Station runtime
proof remains owned by `W5-PROOF` and `W6A-PROOF`.
