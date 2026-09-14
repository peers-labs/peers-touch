# Secure Content - Operational Contract

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Architecture Team

---

## 1. Transaction Ownership

The calling business domain owns the outer transaction.

```text
Social UOW
  -> Post/Comment repository
  -> audience snapshot/envelope repository
  -> Social object/grant repository
  -> delivery/outbox repository
  -> one commit

Conversation UOW
  -> event/receipt repository
  -> Conversation object/grant repository
  -> delivery/outbox repository
  -> one commit
```

The shared Station kernel:

- receives a transaction-bound domain repository;
- validates transitions and exact commitments;
- returns mutations to the owning UOW;
- never opens, commits, retries, or rolls back a transaction;
- never writes a cross-domain table.

Failure before commit leaves no business fact or grant. Completed unattached
objects remain immutable and expire through the owning domain's GC.

## 2. Prepare And PreKey Claims

Prepare spans Social/Conversation and Key Exchange without pretending to be one
distributed database transaction:

1. Domain persists the caller-owned command identity.
2. Domain requests exact one-time PreKey claims under `plan_id`.
3. Key Exchange irreversibly claims keys and stores an exact replay receipt.
4. Domain persists the signed plan and claim commitments.
5. If domain persistence fails, retrying the same `plan_id` returns the same
   claims; a different hash conflicts.
6. If the plan is abandoned, claimed keys remain consumed and are replenished.

This chooses safe key loss over unsafe PreKey reuse.

## 3. Object State Machine

```text
CREATED
  -> RECEIVING_PARTS
  -> VERIFYING
  -> COMPLETE_UNATTACHED
  -> ATTACHED(domain_commit_id)

CREATED/RECEIVING_PARTS -> CANCELLED | EXPIRED
VERIFYING -> RECEIVING_PARTS | TERMINAL_CORRUPT
CREATED/RECEIVING_PARTS/VERIFYING/COMPLETE_UNATTACHED/
  CANCELLED/EXPIRED/TERMINAL_CORRUPT -> GC_CLAIMED -> GARBAGE_COLLECTED
GC_CLAIMED -> RETRY_WAIT | CLEANUP_FAILED
```

Rules:

- part identity is `(upload_id, generation, chunk_index)`;
- identical bytes/hash replay succeeds; different bytes/hash conflict;
- complete requires every chunk and exact whole commitment;
- verification retries start after the observed storage failure, honor the
  persisted next-attempt time, and stop at the shared bounded attempt count;
- background expiry commits `EXPIRED` before a later cleanup lease claims GC;
- corrupt complete stores a deterministic terminal response/hash for exact
  replay before and after GC;
- attach requires the same resource, uploader, descriptor set, and domain UOW;
- download requires the domain's persisted grant, not current object possession;
- immutable ETag is the descriptor SHA-256;
- every full/range read requires exact `expected_descriptor_sha256`;
- no plaintext temporary file is created by Station.

## 4. Domain-Owned Routes

Conversation retains:

```text
/conversation/attachments/*
```

Social owns:

```text
/api/v1/social/moments/objects/uploads/begin
/api/v1/social/moments/objects/uploads/{upload_id}
/api/v1/social/moments/objects/uploads/{upload_id}/chunks/{chunk_index}
/api/v1/social/moments/objects/uploads/{upload_id}/complete
/api/v1/social/moments/objects/uploads/{upload_id}/cancel
/api/v1/social/moments/objects/{object_id}
```

Both route families use the same proto object descriptors, Rust crypto, Go
validation/state-machine kernel, and conformance vectors. Their authorization,
tables, transactions, audit correlation, and retention remain domain-owned.

## 5. Idempotency And Replay

| Boundary | Identity | Replay rule |
|---|---|---|
| prepare | `(domain, actor, command_id)` | same canonical hash returns exact plan |
| PreKey claim | `(plan_id, slot_id)` | same hash returns exact claimed key |
| submit | `(domain, actor, command_id)` | same hash returns exact resource receipt |
| upload part | `(upload_id, generation, chunk_index)` | same hash succeeds, different hash conflicts |
| object attach | `(object_id, domain_commit_id)` | exact replay succeeds |
| local decrypt | `(content_id, generation, ciphertext_sha256)` | existing matching projection is a no-op |
| recovery envelope | `(actor, content_id, recovery_key_id)` | exact replay succeeds |

Command receipt, plan, payload, envelope set, and descriptor set hashes use
canonical protobuf bytes.

## 6. Retry And Failure

| Failure | Behavior |
|---|---|
| recipient PreKey unavailable | fail prepare with exact missing-recipient count; preserve draft |
| abandoned prepare | expire plan; never reuse claimed PreKeys |
| upload interruption | resume verified missing chunks only |
| stale audience/member revision | reject submit; require fresh prepare and encryption |
| submit timeout | query exact command receipt before retry |
| duplicate submit with another hash | terminal conflict |
| grant/object mismatch | terminal security error |
| invalid/expired credential | `401`, no anonymous retry |
| missing local/recovery key | `RECOVERY_REQUIRED`, no plaintext fallback |
| hash/AEAD/signature failure | terminal integrity state, zero partial plaintext |
| storage full/overload | typed retry-after before unbounded admission |
| shutdown/account switch | stop admission, drain bounded work, persist ciphertext checkpoint, zeroize secrets |

## 7. Bounded Admission

Initial protocol policy:

| Resource | Bound |
|---|---|
| private payload ciphertext | 1 MiB |
| objects per resource | 10 |
| object plaintext | 2 GiB |
| object chunks | 2048 at fixed 1 MiB plaintext |
| recipient actors per plan | 256 |
| endpoint plus recovery slots per plan | 1000 |
| active prepare plans per actor | 4 |
| serialized envelope bytes per plan | 4 MiB |
| private comments per actor/post | 30 per rolling hour |
| private comments per Post | 600 per rolling hour |
| active uploads per actor/domain | 4 |
| unattached object TTL | 24 hours |
| plan lifetime | 5 minutes |
| read/recovery page | 100 resources |

Additional domain admission:

- Social applies the declared per-actor/per-Post comment and envelope-byte budgets;
- a plan exceeding policy returns `AUDIENCE_TOO_LARGE` before key encryption;
- Key Exchange reserves inventory for interactive Direct/MLS traffic separately
  from Content PreKeys;
- recovery pagination is bounded and restartable;
- no queue, list, body, envelope set, or retry loop is unbounded.

Changing a numeric bound requires declared workload, runtime cells, sample count,
memory measurement, and abuse analysis.

## 8. Performance Gate

Release-mode Native measurements use five warm-ups, at least 30 samples, and
report P50/P95/P99 plus peak resident memory:

| Workload | Target |
|---|---|
| 1 MiB payload encrypt/decrypt | Desktop P95 <= 100 ms; Mobile P95 <= 200 ms |
| 256 endpoint/recovery envelope seals | Desktop P95 <= 2 s; Mobile P95 <= 4 s |
| policy-limit plan admission | completes within 5 s or rejects before encryption |
| 100 MiB object interrupted at 25/50/75% | only missing chunks transfer; resumed first-byte P95 <= 2 s on declared LAN |
| transfer working set | <= `2 * chunk_size + 16 MiB`; no whole-object buffer |

## 9. Observability

Allowed dimensions:

- domain, operation, typed outcome/error;
- payload/object/envelope count and byte buckets;
- queue depth, lease age, attempt count, latency;
- plan and capability age buckets;
- runtime/platform cell.

Forbidden:

- PTID, device ID, content/object/upload IDs;
- ciphertext, envelope, key ID/public key, signature, hash bytes;
- private text, URL, filename, location, poll label, or mention;
- raw SQL, authorization token, recovery phrase, or plaintext path.

Structured operational events use opaque correlation IDs and the existing
Station log retention policy. W6 does not add a second object-audit authority.

## 10. Hard-Cut Inventory

The execution plan must inventory and close:

- Model proto and every generated Go/Desktop/Mobile binding;
- Social handlers, services, converters, repositories, domain events and tests;
- private Post, Comment, Reaction, Delivery, audience, envelope and object tables;
- stats, Dashboard, moderation, admin/storage inventory and migrations;
- Desktop and Mobile API clients, runtimes, stores, pages, tests and Native commands;
- Messaging Core and Conversation attachment callers, vectors, stores and Gates;
- OSS Social upload/read paths and visibility policy;
- Recovery section composition and restore;
- Acceptance Domains, Features, Gates, fixtures, reports, docs and knowledge.

Completion requires zero live reference to the retired Social cipher, signaling
envelope, plaintext private columns, old envelope JSON, public private-media path,
or legacy `/posts*` API.

## 11. Data Reset

The selected migration is a development-data reset, not a server-side encryption
migration. Execution requires fresh explicit authorization.

Before reset:

- count and hash public rows/objects;
- count private rows, comments, envelopes, deliveries and old media;
- record exact Station/profile scope.

After reset:

- all legacy private rows and old private-media objects are absent;
- public counts and hashes are unchanged;
- new schema rejects plaintext private writes;
- no rollback/fallback path remains.

## 12. Operational Evidence

- domain transaction failpoints at every write boundary;
- exact replay and conflicting replay tests;
- PreKey depletion/replenishment and abandoned-plan tests;
- concurrent submit/delete/block/member-change tests;
- object interruption, restart, corruption, cancellation, quota and GC tests;
- recovery pagination, restart, never-opened content and revoked-content tests;
- Native account-switch and crash tests with recursive secret scans;
- tree-wide hard-cut and schema ownership Gates.
