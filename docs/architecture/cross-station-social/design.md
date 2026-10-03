# Cross-Station Private Social - Architecture Design

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation

---

## 1. Core Principles

1. **Social remains authoritative.** The author's Home Station owns canonical
   Post, Comment, Reaction, audience, and lifecycle truth.
2. **Federation transports opaque domain payloads.** It owns authentication,
   durable retry, ordering, deduplication, and dispatch, but no Social policy.
3. **Every remote projection is viewer-scoped.** One frame targets one actor and
   contains no co-recipient identities or envelopes.
4. **Clients keep plaintext.** Both Stations persist ciphertext, proofs,
   descriptors, and minimum routing metadata only.
5. **Remote writes return to source.** A recipient Home Station never becomes
   authoritative for a remote Post or interaction.
6. **Platform claims are runtime-specific.** Tauri Native Desktop is required;
   Mobile is deferred; browser-gateway Social is prohibited.

## 2. Target Topology

```text
Alice Native Desktop
  | local encrypt/decrypt
  v
Station A
  Social source authority
  +-- audience snapshot
  +-- private resource UOW
  +-- Federation outbox port
  +-- object ciphertext authority
  |
  | authenticated durable Federation delivery / peer route
  v
Station B
  Federation inbox
  +-- Social typed receiver
  +-- Bob viewer-scoped ciphertext projection
  +-- local delivery/reconcile state
  |
  v
Bob Native Desktop
  local proof verification + decrypt + recovery
```

No Desktop connects directly to a remote Station. No private Social payload
enters Federation Ledger.

## 3. Sources Of Truth

| Concern | Owner | Stored truth |
|---|---|---|
| Post/Comment/Reaction lifecycle | author Home Station Social | canonical domain rows and revisions |
| Audience authorization | source Social | immutable publish snapshot plus current revoke facts |
| Endpoint/recovery Content PreKeys | recipient Home Station Key Exchange | one-time pools and exact replay receipts |
| Durable cross-Station movement | Federation | signed frame, outbox/inbox, disposition, ordering |
| Remote viewer projection | recipient Home Station Social | rebuildable actor-scoped ciphertext projection |
| Large encrypted objects | source Social object authority | ciphertext, descriptor, grants, range state |
| Plaintext and content keys | Native client | encrypted local store and active memory only |
| Product freshness | Native Desktop `momentsRuntime` | event consumption plus periodic reconcile |

## 4. Publish Lifecycle

```text
select audience
  -> source Social freezes actor/device/recovery targets and locality
  -> local Key Exchange claims local Content PreKeys
  -> Federation-authenticated peer request claims remote Content PreKeys
  -> Native Desktop encrypts one canonical resource
  -> source Social atomically commits:
       canonical resource
       local delivery intents
       one Federation outbox frame per remote actor
  -> receiver Federation verifies/authenticates/deduplicates
  -> receiver Social atomically commits inbox receipt + viewer projection
  -> Bob Desktop verifies source proof and decrypts
```

### 4.1 Admission

- Every recipient must resolve to one canonical ActorRef and Home Station.
- All Home Stations must belong to the same active Federation selected by the
  source operation.
- Required endpoint and recovery slots are frozen before encryption.
- Any unresolved identity, missing required PreKey, cross-Federation recipient,
  unsupported audience, or size-limit breach rejects the whole publish.
- Consumed one-time keys may be abandoned after failure; recipient sets may
  never be silently reduced.

### 4.2 Remote Content PreKey Claim

The canonical Content PreKey types remain in
`model/domain/secure_content/prekey.proto`. Key Exchange-owned peer wrappers
live in `model/domain/key_exchange/key_exchange.proto`.

The target Key Exchange authority binds exact replay to:

```text
(source_station_peer_id, target_station_peer_id, plan_id,
 plan_request_sha256)
```

The same tuple returns identical claims. Reusing the identity with another hash
is terminal. Federation membership and target Station are verified before any
claim is returned.

### 4.3 Source Commit

The Social UOW uses the shared Federation outbox repository as a
transaction-scoped port. Canonical resource rows and every required remote
frame either commit together or do not commit. There is no post-commit
best-effort fan-out step.

## 5. Delivery And Read

### 5.1 Frame Shape

Each durable frame carries exactly one target actor's:

- encrypted payload;
- endpoint and recovery envelopes;
- encrypted object descriptors;
- source resource identity and monotonic lifecycle revision;
- audience explanation safe for that viewer;
- source commit proof and retained proof-key attestation.

The frame does not carry plaintext, content keys, co-recipient identities,
large object bytes, or business authorization decisions.

### 5.2 Receiver Commit

Federation authenticates the source Station and validates frame bounds before
dispatch. The Social receiver then verifies:

- target Station and target actor;
- payload hash and canonical domain message;
- active Federation scope;
- source proof and resource binding;
- monotonic lifecycle revision;
- envelope principal and object descriptor binding.

Inbox receipt and Social projection mutation commit in one receiver
transaction. Duplicate delivery is a no-op. Same identity with another hash is
terminal.

### 5.3 Object Read

Large object bytes remain at the source Social object authority.

```text
Bob Desktop
  -> Station B Social checks Bob's imported projection
  -> Station B Federation opens a target-bound peer stream
  -> Station A Social revalidates source resource + actor grant + object/range
  -> ciphertext range returns through Station B
  -> Bob Desktop verifies descriptor/hash and decrypts locally
```

The peer capability binds source resource, target actor/device, object ID,
range, expiry, and Federation identity. A capability cannot be replayed for
another object, actor, or range.

## 6. Remote Interaction Lifecycle

Private Comment uses the existing prepare/submit split across the source
authority:

```text
Bob Desktop -> Station B Social durable PREPARE command
  -> Station A Social revalidates parent and creates encryption plan
  -> typed result returns to Bob
  -> Bob encrypts Comment locally
  -> Station B Social durable SUBMIT command
  -> Station A Social commits canonical Comment + recipient deliveries
```

Reaction and unreaction use typed mutation commands without a plaintext
payload. Every command has one immutable command ID and canonical request hash.
The source returns exact replay results; hash conflict is terminal.

Unknown outcomes remain pending and retry with the same command ID. Comment
draft text stays on Bob's Native Desktop.

## 7. Revocation And Recovery

### 7.1 Revocation

Delete, friendship loss, audience loss, device revoke, and block produce a
monotonic source lifecycle revision. The source emits one viewer-scoped
invalidation per affected remote actor.

Receiver behavior:

- locally known block may suppress immediately;
- a tombstone fences every lower or equal delivery revision;
- stale delivery cannot resurrect content;
- feed, detail, Comment, object, and recovery reads share the same denial;
- ordinary local ciphertext/cache is purged without claiming deletion of
  exported or maliciously retained plaintext.

### 7.2 Recovery

The recipient projection retains the actor recovery envelope, source commit
proof, and required retained-key attestation. After trusted recovery, a
replacement Native Desktop can decrypt authorized never-opened history without
the author being online. Revoked devices, expired Federation membership, or a
higher invalidation revision remain denied.

## 8. Native Desktop Boundary

The supported runtime is:

```text
Tauri product window
  -> embedded React Social surface
  -> Tauri command boundary
  -> Desktop Rust Secure Content runtime
```

The embedded React surface is part of Native Desktop. The browser-gateway shell
is a separate runtime and must not register:

- Moments pages or routes;
- `momentsRuntime`;
- Social navigation entries;
- public or private Social actions.

Registration is controlled by an explicit host capability/policy at boot. It
must not rely on a page-level warning after the route has already been exposed.

## 9. Failure Semantics

| Failure | Result |
|---|---|
| remote identity or PreKey unavailable before commit | preserve draft; no Post or partial audience |
| source committed, receiver unavailable | one durable delivery remains pending/retrying |
| duplicate frame | one projection; duplicate disposition |
| hash conflict, wrong target, or untrusted source | terminal rejection; no Social mutation |
| source unavailable during object/interaction request | existing verified content may remain readable; new operation is retryable |
| parent deleted or authorization revoked | interaction terminally rejected |
| stale delivery after invalidation | tombstone wins |
| missing recovery material | explicit recovery state; no plaintext fallback |
| Browser route attempt | no registered Social route or action |

## 10. Forbidden Relationships

- Social must not implement another network transport or outbox/inbox stack.
- Federation must not authorize Social reads or mutations.
- Recipient Social must not authoritatively write a remote resource.
- Secure Content must not become a Social business authority.
- Station must not decrypt private Social content.
- Client must not call a remote Station directly.
- Large object bytes must not enter durable Federation frames.
- Private Social facts must not enter Federation Ledger.
- Mobile implementation must not be added under this plan.
