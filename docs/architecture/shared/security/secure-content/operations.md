# Secure Content - Operational Contract

> **Status**: active
> **Version**: v1.8
> **Created**: 2026-09-13 | **Updated**: 2026-09-21
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

### 2.1 Accepted Client Publication Boundary

Under accepted `SC-D20`, Native publishes and inventories Content PreKeys only
through canonical Key Exchange protobuf routes. Publication uses a deterministic
proof-free command ID, fresh Station/session/device possession proof and one
transaction-held `PENDING -> COMPLETED` receipt. A first-time command must add
at least one immutable key; exact retry returns the receipt, then Native reads
fresh inventory.

Before network send, Native persists private material, proof-free command bytes
and a session-generation send lease in encrypted local storage. Bootstrap turns
orphaned pending/in-flight work into `UNKNOWN_COMMIT` and retries the same
command with a fresh proof. Command state and per-key root-commit state remain
separate. Logout, account/Station switch, vault lock, revocation and shutdown
stop admission, fence callbacks and zeroize in-memory secrets.

EC5A requires PostgreSQL receipt contention, pool/Actor lock ordering,
profile-rotation and revocation races. Its runner requires a DSN, parses
`go test -json`, and rejects missing, renamed, zero-match, skipped or non-pass
mandatory cases.

### 2.2 Proposed Deterministic Lifecycle Choreography

Under accepted `SC-D21`, lifecycle evidence uses barrier release rather than
timing:

```text
arm operation
  -> await persisted-before-send
  -> assert durable production state digest
  -> release barrier
  -> await sent-before-response
  -> assert dispatch identity
  -> release barrier
  -> await response-before-local-commit
  -> assert local state has not advanced
  -> release barrier
  -> await production operation result
```

Each wait is bounded only as a failure budget. Reaching the budget records a
typed failure; it is never interpreted as evidence that no event occurred.
Barrier order, boot identity, session generation, operation ID, and runtime
manifest digest must match at every step.

A forced restart ends the current scenario invocation:

```text
scenario -> immutable resume artifact -> restart request -> BLOCKED
runtime owner -> lease -> restart with retained storage -> child manifest
scenario continuation -> validate lineage/new boot -> consume resume artifact
```

Only the runtime owner performs the middle step. The continuation count is one
per restart request. Reusing the parent manifest, observing the same boot
identity, changing retained-storage identity, or missing owner acknowledgement
is terminal evidence failure.

Fixture acquisition occurs before scenario admission. Missing account,
Station, revocation, or historical-recovery handles return
`FIXTURE_CAPABILITY_UNAVAILABLE`. A scenario cannot repair that blocker by
creating state or mutating owner persistence directly.

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
| PreKey publication | deterministic `(publisher endpoint, command_id)` | transaction-held same command/hash replays; another hash conflicts |
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
| publication response lost | retain `UNKNOWN_COMMIT`; retry same proof-free command with a fresh Station/session/device proof |
| publication stale epoch | read fresh inventory; sign a new deterministic command |
| terminal publication error | omit `Retry-After`; do not retry |
| retryable publication error | shared `ErrorResponse` plus `Retry-After` in `1..300` |
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
| Content PreKeys per publication/pool | 100 |
| Content PreKey publish/inventory body | 128 KiB / 4 KiB |
| possession-proof clock skew | 60 seconds |
| retry-after hint | 300 seconds maximum |

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

Accepted `SC-D23` defines the only legal reset targets:

| Profile | Deploy environment | Scope |
|---|---|---|
| `four` | `station-four` | `station-four-social-private` |
| `fiveArm` | `station-five-arm` | `station-five-arm-social-private` |

The canonical workspace binding is restored to profile `four`, slot `5`.
Profile `one`, production targets, and any inferred alias fail closed.

Accepted `SC-D24` defines two reset intents over the same closed operation:

- `SCHEMA_ACTIVATION`: complete the reset on both profiles for the exact
  source/runtime checkpoint and publish current canonical-schema attestations
  before any private Social Journey starts;
- `FINAL_CUT`: execute a fresh reset after hard-cut regression readiness, then
  run the complete product matrix against newly populated canonical state.

The reset owner accepts intent as a typed manifest field, not a free-form CLI
flag. Each intent requires its own reset ID, immutable manifest, exact
declaration, scope authorization, and lease. An activation journal cannot be
relabelled as final-cut evidence.

SC-D24 replaces only SC-D23's W12-exclusive task restriction.
Both intents still use exactly the accepted profiles and destructive scopes.
The Plan must assign each intent to one explicit task; an unplanned task or
ad-hoc command remains unauthorized.

The non-public maintenance operation runs as an OS-authenticated remote CLI
through the reviewed deploy transport. The local SSH transport is a direct
child of the generic `machine-dev` lease wrapper, which retains the inherited
`station.reset` lock for the full operation. The reset owner passes a typed
`SecureContentResetInvocationV1` over SSH stdin. The CLI validates source,
environment, scope, intent, reset-manifest digest, declaration digest, and
expiry, then acquires a database advisory lock keyed by deployment environment
and destructive scope. It exposes no network route and accepts no durable
bearer credential.

Before reset:

- verify clean exact source, the plan task assigned to the requested reset
  intent, exact profile/scope authorization, and the live `station.reset` lease;
- quiesce the selected Station and reject new Social private mutations;
- snapshot and canonically hash public Posts, public Comments/Reactions, and
  public Social OSS metadata/object bytes;
- inventory every canonical private table row, legacy private shared-table row,
  canonical Social object key, and legacy OSS `(owner,key)` reference;
- freeze the reviewed table/column/predicate/object allowlist into one immutable
  reset manifest;
- reject unknown schema, attachment encoding, ownership, object digest, or
  cross-domain/shared reference before mutation.

The database mutation is one transaction:

1. clear exactly `social_private_content_plans`,
   `social_private_content_plan_slots`,
   `social_private_command_receipts`, `social_private_posts`,
   `social_private_comments`, `social_private_audience_snapshots`,
   `social_private_recipient_grants`, `social_private_content_envelopes`,
   `social_private_delivery_intents`, `social_private_object_uploads`,
   `social_private_object_parts`, `social_private_objects`,
   `social_private_object_grants`, and `social_private_commit_proofs`;
2. delete only `social_comments` and `social_reactions` rows whose
   `post_class = 'private'`;
3. clear `social_moment_deliveries`;
4. drop only `social_private_audience_grants`;
5. rebuild the emptied `social_private_posts` table to the canonical encrypted
   model, removing only the retired columns listed by `SC-D23`.

Before the first activation, the reset owner also admits the exact known hybrid
shape produced when canonical columns were added to the retired table:
canonical column types must already match, defaults may only be absent or equal
to the canonical default, no unknown columns are allowed, and the primary key
must be either retired `id` or canonical `post_id`. The reset still clears all
private rows before rebuilding the complete canonical constraints and indexes.

Every clear is an exact `DELETE`; `TRUNCATE CASCADE`, wildcard DDL, and
schema-wide drop are forbidden. Child/shared legacy rows are deleted before
their parent rows in the dependency order fixed by `SC-D23`. An unexpected
foreign-key edge fails pre-audit instead of widening the operation.

Object deletion is owner-mediated and idempotent:

- Social's object adapter deletes canonical private object/part/upload bytes;
- OSS deletes legacy private file metadata and releases blob references;
- shared CAS bytes remain while another live metadata row references them;
- direct storage-backend or OSS-table mutation by the reset runner is forbidden.

One monotonic journal records:

```text
PREPARED
  -> DATABASE_SCHEMA_COMMITTED
  -> OBJECTS_DELETED
  -> STATION_DEPLOYED
  -> POST_AUDIT_PASSED
  -> COMPLETE

PREPARED
  -> SUPERSEDED

OBJECTS_DELETED
  -> RECOVERY_REPLACED

STATION_DEPLOYED
  -> RECOVERY_REPLACED
```

The `station.reset` lease remains held through the whole sequence. A partial
failure may resume only with the same reset-manifest digest. It never restores
legacy readers, changes target, or starts Station before deletion/schema
closure.

Cancellation before database commit rolls back and leaves the journal at
`PREPARED`. Cancellation, timeout, SSH disconnect, or lease loss after a
durable transition leaves Station quiesced at the last journal state. Resume
requires the same reset manifest plus a fresh invocation ID. The journal records
accepted invocation IDs and digests; exact replay returns its current state,
while a conflicting digest for one invocation ID fails without advancing the
journal.

`OBJECTS_DELETED` is returned without error only by the invocation that first
crosses that boundary, instructing the Development owner to deploy. A later
invocation beginning at `OBJECTS_DELETED` is a post-deployment verification
attempt; deployment or attestation verification failure is returned as the
typed error and must never be collapsed back into another successful
`needs_deployment` response.

If a source defect invalidates a reset while its journal remains `PREPARED`,
the first invocation for the fresh source may atomically transition the old
journal to terminal `SUPERSEDED` and create the new `PREPARED` journal. This
requires the same workspace, profile, deployment environment, destructive
scope, and intent, a different source commit, the new exact-source declaration
and lease, and the same remote advisory lock. Same-source conflicts and every
post-commit state remain non-supersedable. A superseded reset cannot resume or
produce successful evidence.

Accepted `SC-D26` handles only two verified source-invalidated boundaries:
an unfailed `OBJECTS_DELETED` deployment handoff, or `STATION_DEPLOYED`
followed by canonical schema failure
`RESET_SCHEMA_TARGET_UNREVIEWED`. The corrected source performs a fresh
pre-audit. Its immutable manifest includes one `recovery_predecessor` that
binds the old reset ID, manifest digest, pre-transition journal digest, exact
state, and corresponding closed replacement reason.

Fresh invocation admission locks the active scope and revalidates:

- equal workspace, profile, deployment environment, destructive scope, reset
  intent, database identity, and public snapshot;
- different source commits and reset IDs;
- exact predecessor manifest and journal digests; and
- no concurrent journal change since the fresh audit.

Only then may one transaction append
`OBJECTS_DELETED|STATION_DEPLOYED -> RECOVERY_REPLACED` and create the fresh
`PREPARED` journal. A deployment-handoff predecessor records
`RESET_SOURCE_SUPERSEDED`; a post-deploy predecessor retains its schema
failure. The old reset remains terminal non-success. The fresh reset reruns the complete SC-D23
database/object operation. Its post-audit additionally loads every object
target from the bounded, cycle-free predecessor chain's immutable Station
ledgers and requires the original Social or OSS owner to prove that target
remains deleted. Only then may it earn its own completion evidence. No other
post-commit state or failure code is recoverable through this path.

Accepted `SC-D27` additionally admits
`OBJECTS_DELETED + RESET_PARTIAL_FAILURE`, because that state is persisted only
after database commit and owner-mediated object deletion complete. It also
admits `STATION_DEPLOYED + RESET_JOURNAL_STATE_CONFLICT` only when the failed
manifest already carries a recovery predecessor and the complete inherited
chain validates under the admission transaction. Both source-defect branches
use replacement reason `RESET_SOURCE_SUPERSEDED`.

Every recovery replacement writes one append-only Station receipt containing
the exact predecessor and initial-successor identities, the locked
pre-transition journal digest, original failure code, replacement reason, and
replacement time. The predecessor journal retains its original failure fields.
The journal digest is an admission compare-and-swap token; terminal validation
requires the immutable receipt and does not reconstruct historical state from
the changed terminal row.

If source changes again while the recovery successor is still `PREPARED`,
SC-D25 may supersede that uncommitted reset only when the next manifest inherits
its exact `recovery_predecessor`. This prevents source churn from truncating
the predecessor object-proof chain.

After reset:

- all canonical and legacy private Social rows and private object references
  are absent;
- canonical private tables and indexes exactly match the current models;
- retired table and columns are absent;
- public counts and hashes are byte-equal to the pre-audit snapshot;
- new schema rejects plaintext private writes;
- no rollback/fallback path remains;
- Station health and live commit equal the immutable reset manifest.

The deployment attestation always carries the full source commit. If the live
version endpoint exposes the repository's canonical 12-hex abbreviated commit,
verification accepts it only as a valid hexadecimal prefix of that full
attested commit; arbitrary or shorter prefixes remain invalid.

Only `POST_AUDIT_PASSED -> COMPLETE` is success. Timeout, cancellation, lease
loss, object deletion failure, deployment failure, or audit mismatch is a typed
partial failure and remains non-successful.

After `SCHEMA_ACTIVATION` completes, the reset owner emits one immutable
`CanonicalPrivateSchemaAttestationV1` per profile. Runtime admission rejects a
missing attestation, a non-complete journal, source/profile/runtime mismatch,
service/peer identity mismatch, service-attestation mismatch, retired columns,
schema digest drift, or reset-time public-snapshot provenance mismatch. Before
publishing a runtime manifest, the runtime owner sends one read-only
`schema_verify` request through the OS-authenticated maintenance SSH command.
That verification does not quiesce Station, migrate control tables, or require
business tables to remain empty after activation. Any immutable identity or
schema drift requires a fresh authorized activation for the new exact
checkpoint. Multi-service runtime owners derive the exact read-only command
from the attestation's canonical profile and deployment environment through
the reviewed remote deploy transport. Profile-name, endpoint, caller-supplied
command, and environment-variable command inference are forbidden. The
read-only operation cannot carry or inherit a destructive reset declaration.

## 12. Operational Evidence

- domain transaction failpoints at every write boundary;
- exact replay and conflicting replay tests;
- PreKey depletion/replenishment and abandoned-plan tests;
- canonical publish/inventory wire, possession-proof, receipt-growth and
  mandatory PostgreSQL concurrency tests;
- concurrent submit/delete/block/member-change tests;
- object interruption, restart, corruption, cancellation, quota and GC tests;
- recovery pagination, restart, never-opened content and revoked-content tests;
- Native account-switch and crash tests with recursive secret scans;
- exact lifecycle barrier ordering and stale-token/generation/boot negatives;
- restart manifest lineage, changed boot identity, retained-storage continuity,
  and one-shot resume consumption;
- WebSocket/SSE terminal-marker sequencing with streams remaining open;
- fixture-owner acknowledgements for account/Station switch, revocation, and
  historical recovery epoch;
- tree-wide hard-cut and schema ownership Gates.
