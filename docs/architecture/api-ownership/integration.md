# Service API Capability Ownership — Integration And Remediation

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-06 | **Updated**: 2026-09-07
> **Owner**: Architecture Team

---

Conversation is the sole Chat entry point at `/conversation/*`. Device, Inbox,
Recovery, Key Exchange, and Federation APIs are exposed only by their resource
owners at `/device/*`, `/device/inbox/*`, `/recovery/*`, `/key-exchange/*`, and
peer-only `/federation/*`.

## 1. Pre-Consolidation Evidence Ledger

| Claim | Class | Evidence | Confidence |
|---|---|---|---|
| Conversation was established as the unified Chat API before the Device Messaging Engine | `verified_fact` | commit `28ef63ebef1cc45c5c55ce9186af978f91334a4e`; `compat-chat-elimination.md` | high |
| A later Station facade added a second create/list/command API | `verified_fact` | commit `04ef1c1c6aceab7632524c0cadf64007f843a72e`; historical source | high |
| The two APIs use separate proto request families | `verified_fact` | `conversation_api.proto` and `messaging_api.proto` | high |
| The two APIs use separate authority services and table families | `verified_fact` | `conversation/service_impl.go`, `messaging/application/*`, `conversation_*`, `messaging_*` tables | high |
| Messaging decisions required one Conversation framework and a hard cut | `verified_fact` | `MP-D09`, `MP-D10` | high |
| The execution plan prohibited production registration before W05 and required old route deletion | `verified_fact` | Messaging plan Atomic Cutover Groups and MP-W05 | high |
| The durable Messaging implementation landed on a history where the Messaging architecture set was not present | `verified_fact` | `04ef1c1...^` and `04ef1c1...` contain no `docs/architecture/messaging-platform/`; docs arrived on a parallel/later line | high |
| W11 checks do not detect semantic API or truth-store duplication | `verified_fact` | `messaging-w11.yaml` checks retired prefixes and crypto symbols only | high |
| The Chat feature contract and contract test asserted the duplicate public routes | `verified_fact` | historical `chat-service-contract.yaml` and `messaging_platform_contract_test.py` | high |
| The architecture failed because owner prose had no executable route/store identity | `inference` | all facts above; exact-route checks passed while semantic duplicates remained | high |
| A machine capability registry plus hard-cut Gate prevents the same class of drift | `accepted_decision` | AO-D01 through AO-D04 | accepted |
| A shared Federation transport unblocks cross-Station Friend Request without a Social or Mobile transport silo | `accepted_decision` | AO-D05 | accepted |
| Conversation requires a DDD bounded context before authority consolidation | `accepted_decision` | AO-D06 and current flat-package inventory | accepted |
| CA-W1 creation requests cannot carry the exact command identity required by the DDD authority | `verified_fact` | `conversation_api.proto`; Conversation application command service | high |
| Active Messaging architecture replaced `CommittedConversationEvent` with `ConversationEvent` | `accepted_decision` | MP-D13; `event.proto` | accepted |
| Public Social mutations cannot carry the signed command required by receiver-authority application logic | `verified_fact` | `relationship.proto`; `FederatedFriendRequestService` | high |
| Destructive key-material fetch lacks exact-response retry identity | `verified_fact` | Key Exchange canonical store and service | high |
| `AO-D07` closes these wire gaps without changing capability ownership or product journeys | `proposal` | `proposals/20260907-ca-w5-canonical-wire-contract-amendment.md` | pending Owner review |

## 2. Root Cause Chain

The failure is not “someone chose the wrong noun.” It is the following complete chain:

1. **The older architecture established the right domain.** Conversation was the
   unified Chat API and authority boundary.
2. **The later architecture introduced a valid new technical unit.** Device Messaging
   Engine, ordered device queues, recovery, attachment transfer, and durable Federation
   delivery were needed.
3. **The new role was named too broadly.** “Station Messaging Authority” covered both
   Conversation business authority and device delivery. The docs did not list the exact
   public route disposition.
4. **Architecture and implementation evolved on different commit lines.** The production
   Messaging subserver registered routes while its formal architecture was not an ancestor
   of that implementation commit. The review could not mechanically prove conformance.
5. **The execution cutover was not enforced.** W02 said test-only; W05 required old route
   deletion. Production registered two public owners for the same capabilities.
6. **The completion Gate measured the wrong property.** It rejected `/friend-chat/*`, but
   not a second semantic Chat route or authority store. Later tests required the duplicate
   route, converting drift into an asserted contract.
7. **Documentation consolidation never completed.** `federated-im` remained discoverable,
   Messaging Platform was active but absent from the main docs index, and no supersession
   record resolved the overlap.

Therefore the architecture intent was partly clear, but the governing contract was
incomplete and contradictory. The missing rule was not “avoid duplicate strings”; it was
“one semantic capability, one public owner, one contract, one truth store,” backed by a
Gate.

## 3. Canonical Route Ownership

| Capability | Canonical route | Owner |
|---|---|---|
| Direct create and list | `/conversation/direct`, `/conversation/list` | Conversation |
| Command prepare and submit | `/conversation/command/prepare`, `/conversation/command` | Conversation |
| Group and membership prepare | `/conversation/group/prepare`, `/conversation/membership/prepare` | Conversation |
| Target-member administration | `/conversation/member/update` | Conversation |
| Atomic ownership transfer | `/conversation/ownership/transfer` | Conversation |
| Read, typing, and delivery facts | `/conversation/read-cursor`, `/conversation/typing`, `/conversation/delivery/receipt` | Conversation and Conversation Delivery |
| Attachment transfer | `/conversation/attachments/*` | Conversation |
| Device identity | `/device/*` | Actor Identity |
| Per-device Chat inbox | `/device/inbox/*` | Conversation Delivery |
| Recovery revisions | `/recovery/*` | Recovery |
| Public key material | `/key-exchange/*` | Key Exchange |
| Peer transport | `/federation/*` | Federation |
| Friend Request | `/api/v1/social/friend-request*` | Social |

Exact retired identifiers are maintained only in
`station-api-capabilities.yaml` and the regression fixtures that prove their
absence. They are not part of the public architecture vocabulary.

AO-D10 keeps target-member administration separate from actor-local settings:

```text
/conversation/member/update
  -> role member/admin and authority mute/deadline for a target member

/conversation/ownership/transfer
  -> one atomic old-owner/new-owner authority transition

/conversation/member/settings
  -> authenticated actor's local nickname/notification/background preferences
```

The first two routes require exact command identity plus authority
sequence/hash/epoch preconditions. Their committed event and complete
post-state are the only Federation follower and device projection input.

## 4. Pre-Consolidation-To-Target Truth Mapping

| Concern | Current state | Target state |
|---|---|---|
| Conversation identity/membership/events | `conversation_*` and `messaging_*` both authoritative | one Conversation authority store using modern transaction semantics |
| Command receipt/idempotency | separate receipt implementations | one Conversation command receipt journal |
| Device queue | Messaging-owned | Conversation Delivery-owned device inbox |
| Read cursor | Conversation and Messaging implementations | Conversation-owned actor read cursor |
| Delivery receipt | Conversation and Messaging paths | Conversation Delivery-owned endpoint receipt |
| Federation outbox/inbox | Chat-specific Messaging infrastructure | shared Federation transport with typed adapters |
| Friend Request | Social local repository only | receiver-authority Social state + sender replica through shared transport |

## 5. Document Reconciliation

As an accepted hard-cut requirement:

- `messaging-platform` remains the current end-to-end Chat architecture root, but
  adopts `/conversation/*` and the plane split from this accepted contract;
- accepted Federated IM authority semantics are incorporated into Messaging Platform;
- `federated-im` is marked `superseded` as a standalone current source and retained as
  history with forward links;
- `social-runtime` remains the client projection source; Station Social Friend Request
  authority and cross-Station delivery are linked to the federated social source;
- `docs/README.md` lists one current Chat architecture source and this global ownership
  contract;
- `docs/global/first-principles.md` no longer recommends compatibility shims without an
  explicit accepted migration decision and removal trigger.

## 6. Required Consumer Reconciliation

The execution inventory must include at least:

- Station `conversation`, `messaging`, `social`, and Federation composition;
- `conversation_api.proto`, `messaging_api.proto`, Social/Federation proto sources, and
  all generated bindings;
- Desktop Rust Messaging Engine transport and remaining Conversation gateway callers;
- Mobile Rust transport and Web Social/Chat gateway callers;
- Acceptance fault proxies, runtime runners, capability/feature registries, contract
  tests, W11 closure, and reset/readback SQL;
- presence, member settings, attachment grants, and any service reading Conversation
  membership;
- docs, knowledge entries, and directory READMEs owned by changed paths.

## 7. Completion Conditions

The remediation is not complete until all are true:

1. Conversation is the sole Chat route owner; the retired Station facade has no
   live routes, callers, tests, fixtures, or documentation claims.
2. `CreateMessagingDirectConversation*` and `ListMessagingConversations*` have zero live
   source references and generated output is regenerated.
3. Only one Conversation authority table family exists after clean reset.
4. Conversation is a DDD bounded context and the replaced flat handler/service/repository
   owners have zero live references.
5. Desktop and Mobile use the same canonical resource routes.
6. W11 rejects, rather than requires, the duplicate routes and stores.
7. `station-api-ownership` passes from the accepted registry.
8. Two-Station Chat still passes outage/retry/restart and native receiver Gates.
9. Two-Station Friend Request passes send, receiver materialization, duplicate retry,
   accept/reject return, relationship convergence, and event-after-commit.
10. No compatibility route, redirect, dual write, fallback read, or domain-specific
   Federation transport remains.

## 8. Proposed CA-W5 Wire Reconciliation

CA-W5 has reached a design gate because the active semantic contracts cannot be
represented by the current canonical request families. Proposed `AO-D07` defines one
coherent correction:

```text
caller-owned exact identities
  + signed cross-Station mutations
  + one ConversationEvent truth
  + exact-response destructive reads
  + typed peer Key Exchange
  + shared durable Federation mutation delivery
```

The proposal is documented at:

```text
proposals/20260907-ca-w5-canonical-wire-contract-amendment.md
```

Until accepted:

- proto regeneration and production composition remain blocked;
- the current uncommitted CA-W5 source tree is preserved;
- no compatibility route or partial registration may be committed;
- focused dependency-ready evidence remains valid but does not prove CA-W5.

After acceptance, the ownership registry, canonical proto sources, generated
bindings, Station owners, client runtimes, Acceptance contracts, and deletion scans
must change in one CA-W5 execution closure.

## 9. Accepted Boundary And Plan Handoff

The Owner accepted one coherent package on 2026-09-06:

- `/conversation/*` remains the canonical Chat business API;
- the retired Station Chat facade is absent;
- Device, Inbox, Recovery, Key Exchange, Attachment, and Federation routes move to
  their actual resource owners;
- Conversation becomes a Station DDD bounded context before authority consolidation;
- Social remains the Friend Request authority;
- Federation transport becomes domain-neutral shared infrastructure;
- duplicate routes, proto types, stores, and callers are removed atomically;
- ownership becomes a machine-checked repository contract.

Implementation sequencing, atomic cutover groups, and evidence are owned by
`execution-plans/20260906-conversation-authority-hard-cut.md`.
