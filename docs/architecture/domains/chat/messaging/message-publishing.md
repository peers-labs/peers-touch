# Message Publishing And Event Aggregation

> **Status**: accepted
> **Created**: 2026-10-14 | **Updated**: 2026-10-14
> **Owner**: Messaging Platform Team
> **Scope**: HTTP publishers, service plaintext, common content, client aggregation

## Product Contract

Scripts, tools, programs, CI, external services, and Bots can publish messages.
HTTP and Webhook describe ingress transports. Bot describes an optional sender
product. Neither owns message content or an independent Conversation data plane.
A program does not need a Bot registration.

An authenticated publishing grant delegates one stable Actor sender and a
bounded set of local service conversations. Credentials can rotate independently
of that grant. Grant provisioning reuses Actor minting and secret primitives;
it does not introduce an identity platform or a new Actor kind. A caller can
share an existing delegation instead of creating an Actor per process.

Conversation owns authorization, immutable message identity, authority order,
history, command receipts, device delivery, read cursors, and message operations.
The publication response identifies the committed command, message,
conversation, event, sequence, and ACCEPTED or REPLAYED outcome.

## Common Content

`model/domain/chat/` owns the sole typed content contract:

- One primary text, structured event, or supported card.
- Attachments alongside any primary content, referencing authorized objects.
- Derived fallback text, never an independent source of business state.
- Optional untrusted source context for display and diagnostics.

Structured events carry a namespaced event type, optional upstream event ID,
subject kind/ID/execution, occurrence time, severity, title/body, supported
actions, and optional typed detail. Task state detail carries a positive,
monotonically increasing revision and a reported state.

Unknown event classifications are displayable generic events. They do not
authorize actions or participate in task state aggregation without typed detail.
Supported actions open validated HTTP(S) URLs; external event names never
execute code.

Human encryption continues to serialize the existing `MessagePrivateContent`
wire through adapters. Its field numbers, format version, attachment metadata,
Double Ratchet, and MLS paths are unchanged by common logical content. Service
plaintext uses its own envelope containing the same logical content. Station
does not receive human private plaintext.

## Stable Publishing Identity

The stable publishing subject is the persisted Actor/delegation binding ID.
It is not a secret, token hash, process ID, rotating credential ID, or caller
supplied source label. The binding fixes sender and trusted source namespace.
Credential rotation changes only authentication material. Revocation and expiry
are checked on every request, including replay.

The idempotency identity is `(publishing subject, command_id)`. Omitted command
IDs are generated and returned; independent calls without retained IDs do not
promise deduplication. HTTP `Idempotency-Key` and a body command ID must agree.

## Request Identity And Default Targets

Normalization validates content and computes deterministic protobuf bytes.
The request hash covers the caller's normalized request, including whether the
target was omitted, content, and meaningful source context. No current default
is substituted into this hash.

On first submission, Conversation resolves and authorizes the target and stores
both the request hash and the resolved sender/target in the publication receipt.
They commit atomically with the message and device delivery.

On replay:

1. Authenticate the currently presented credential and check the live binding.
2. Load the receipt by stable publishing subject and command ID.
3. Compare the exact normalized request hash; a mismatch returns a typed conflict.
4. Authorize the stored sender/target against the current grant.
5. Return the original committed result without resolving a new default.

A changed default does not redirect an old omitted-target command. Removing its
original target from the current grant rejects replay. Explicitly changing the
target is a different request and conflicts under the same command ID.
Concurrent submissions serialize at the stable publishing subject; the durable
unique key supplies the persistence backstop.

Publication receipts follow their Conversation message retention. There is no
independent 24-hour dedupe window. Retained receipts prevent repeated effects.
If message and receipt are removed by an authorized retention operation, a later
submission is new; the API must not claim deduplication after removal.

## Transaction And Notification

One Conversation unit of work commits authority state, message/event, endpoint
delivery, publication receipt, and the applicable notification row. Notification
preference or mute decisions can suppress the row without suppressing the
message. A required row insertion failure rolls back the transaction.

Online inbox wake and OS presentation occur after commit. Failure there cannot
change ACCEPTED into a retryable message failure. A replay creates neither a new
message nor a notification row.

Notification category follows content semantics. Task detail uses TASK;
ordinary text/cards use the ordinary message category. Publisher severity
cannot override recipient policy. Notification grouping is derived separately
and does not become publication idempotency or task identity.

## Service Conversation Security

Service plaintext can enter only a local direct conversation explicitly
provisioned for a system sender and recipient. Provisioning and submission
validate the live sender delegation and target authorization transactionally.
An existing human E2EE direct conversation or MLS group cannot be converted
implicitly. Actor kind does not replace message delivery security.

Real active recipient devices come from the Actor Directory. The reserved
Station system sender is not a recipient device and needs no invented device
keys. Device inbox, authority hash chains, consume receipts, unread/read
sequences, recovery, and history remain the existing messaging engine's work.
Cross-Station service plaintext is outside this contract.

## Event Aggregation

The grouping identity is conversation, authenticated sender, trusted source
namespace, subject kind, subject ID, and execution ID. A task state event without
complete execution identity remains an individual message.

Every event is an independent persistent message. A client derives an activity
card at the group's latest known message position, even when other messages
interleave. Expanding it restores each member in message order. Independent
approvals and events without task state detail remain individual.

The highest applicable revision supplies the reported state. Lower revisions
remain history. Equal revisions with conflicting state are visibly conflicting,
not resolved by arrival time. An earlier terminal report prevents a later
nonterminal report from silently reopening the same execution; a rerun uses a
new execution ID. The publisher does not mutate Agent/Task business authority.

Aggregation uses the device's persistent known messages, deduplicated by message
ID. Paging, refresh, restart, and replay do not increment a separate counter.
When history is incomplete, the card reports known count and latest known
state, with an explicit partial-history marker. It does not claim a total count
or definitive execution state. No aggregate service, table, or task authority
is introduced.

Search, location, quote, pin, reactions, and message operations retain individual
message IDs. Locating a folded member expands its group. Read cursors advance
through actual authority sequence, never the number of visible cards.

## Atomic Cutover

Replace Bot ingress DTOs, event-only sinks, `ServiceBotEventContent`, and mixed
`request_id/group_key/dedupe_key` semantics. Bot management can provision or
manage a generic publishing grant, but cannot own normalization, receipts, or
delivery. Remove old routes and generated DTOs rather than keep aliases,
compatibility readers, or double writes. Reserve retired protobuf tags.

Shared Native and Desktop consumers persist common content, and Desktop/Mobile
render it from their message projections. Preserve fallback history without
resetting human databases. Old service payloads are explicitly unsupported
after the coordinated source/client cutover; removing source does not authorize
runtime data deletion.

The dependency order is common contract → publishing and all consumers →
semantic aggregation → removal and documentation → exact-source verification.
Each producer/consumer replacement is completed before delivery.

## Verification Obligations

Required functional proof covers a non-Bot program publishing and recovering
text; concurrent/lost-response retry; changed content and targets; rotation and
revocation; omitted-target replay after default changes; attachments and cards;
interleaved executions; late and conflicting revisions; partial history and
restart; locating individual members; plaintext rejection for E2EE/MLS; and
human chat regression.

Static checks or this accepted document are not runtime proof. Verification
results must name actual source and explicitly identify unrun product scope.

## Related Sources

- [Messaging design](./design.md)
- [Messaging data model](./data-model.md)
- [Bot product](../../bot/product-definition.md)
- [Public API documentation](../../../../api/README.md)
- [Approved design and benchmarks](../../../../context/)
