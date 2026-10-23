# X Config - Data Model

> **Status**: active
> **Version**: v2.2
> **Created**: 2026-10-17 | **Updated**: 2026-10-24
> **Owner**: Client Platform
> **Module**: `apps/x-config/`

---

## 1. Signed Snapshot

```proto
message SignedXConfigSnapshot {
  string signing_key_id = 1;
  bytes statement_bytes = 2;
  bytes ed25519_signature = 3;
}

message XConfigSnapshotStatement {
  uint32 schema_version = 1;
  string channel = 2;
  uint64 sequence = 3;
  google.protobuf.Timestamp issued_at = 4;
  google.protobuf.Timestamp expires_at = 5;
  repeated EndpointSeed endpoint_seeds = 6;
  repeated ReleaseDescriptor releases = 7;
  // field 8: directives (XCFG-D04); field 9: distribution (XCFG-D06).
  repeated Directive directives = 8;
  DistributionConfig distribution = 9;
}

message DistributionConfig {
  // Ordered future-fetch origins (failover sequence); each entry passes
  // the closed snapshot-origin admission policy.
  repeated DistributionOrigin origins = 1;
}

message DistributionOrigin {
  string origin = 1; // clean base URL, no path/query/fragment/credentials
}
```

Signature input:

```text
"peers-touch/x-config/v1\0" || statement_bytes
```

The envelope is deterministic protobuf. Clients verify `statement_bytes`
directly and never reserialize a decoded message.

## 2. Catalog

The reviewed YAML catalog contains:

```text
Catalog
  schema_version = 1
  channel
  endpoints[]
  releases[]
  directives[]            # XCFG-D04
  distribution.origins[]  # XCFG-D06
```

Endpoint rules:

- at most 128 entries;
- unique bounded seed IDs;
- peer-domain `PublicEndpointConnectionMaterial`;
- Relay or Direct Station kind only;
- Direct Station additionally carries valid public owner consent;
- material and consent expiry bound actionability.

Release rules:

- at most 64 entries;
- HTTPS manifest and release-note URLs;
- semantic version and minimum version;
- SHA-256 manifest digest;
- explicit release signing key ID;
- no command or executable payload.

Directive rules (XCFG-D04):

- at most 32 directives, 16 rules per directive, 8 values per target field;
- keys belong to the closed registry (`network.default_relay`,
  `network.default_station`); endpoint-valued directives reference existing
  seeds of matching kind; fallback is required and same-typed.

Distribution rules (XCFG-D06):

- at most 4 unique origins per snapshot in declared failover order;
- each origin is a clean base URL under the snapshot-origin admission
  policy: HTTPS for any host, plain HTTP only for loopback/RFC1918/
  link-local IPv4 or IPv6 loopback; no path, query, fragment, or credentials;
- the section is advisory transport: it never carries publisher trust.

## 3. Draft

```text
Draft
  revision              # current repository head
  content_sha256
  catalog
  loaded_at
```

Save requires `base_revision == repository HEAD`. The catalog is serialized to
canonical reviewed YAML and written to:

```text
x-config/catalogs/<channel>.yaml
```

Any repository mutation, including publication, advances the revision exposed
to the console.

## 4. Publication

```text
Publication
  schema_version = 1
  publication_id        # publication-<20-digit sequence>
  channel
  sequence
  source_revision
  content_sha256
  signing_key_id
  statement_sha256
  envelope_sha256
  published_by
  published_at
  expires_at
  catalog
```

Atomic storage:

```text
x-config/publications/<channel>/current.json
x-config/publications/<channel>/<20-digit-sequence>.json
x-config/snapshots/<channel>/<20-digit-sequence>.pb
```

The transaction reads the current publication from the same repository
snapshot, allocates `sequence + 1`, signs the deterministic statement, and
writes all three paths in one commit. Metadata never embeds the private key or
duplicates envelope bytes.

Invariants:

- source revision and digest equal the acknowledged draft;
- sequence starts at one and strictly increases;
- publication ID is derived from sequence;
- statement/envelope digests are lowercase SHA-256 hex;
- published and expiry times are UTC and bounded by seven days;
- current metadata and immutable envelope agree;
- a missing or digest-mismatched envelope is unavailable, never synthesized.

## 5. Operator Session

Operator authentication state is stored in the Home-local SQLite database:

```text
operator_login_attempts
  attempt_digest PRIMARY KEY
  receiver_verifier_envelope
  created_at
  expires_at
  consumed_at?

operator_assertion_consumptions
  assertion_digest PRIMARY KEY
  session_id
  consumed_at

operator_sessions
  token_digest PRIMARY KEY
  session_id UNIQUE
  csrf_digest
  provider
  provider_subject
  assertion_id
  issued_at
  expires_at
  revoked_at?
```

The receiver verifier uses an AES-256-GCM envelope bound to the record kind and
attempt digest. Session and CSRF cookies are opaque random values; only their
SHA-256 digests are stored. Provider credentials and signed assertion bytes are
never persisted by X Config.

The audience-bound OAuth assertion identifies provider and provider subject.
The service admits only configured subjects. Mutations require the session
cookie and matching CSRF cookie/header.

Login completion is one SQLite transaction:

```text
read current unconsumed attempt
  -> redeem one-time Broker handoff
  -> verify assertion and allowlist
  -> BEGIN IMMEDIATE
  -> recheck attempt current and unconsumed
  -> insert attempt consumption
  -> insert assertion consumption
  -> insert session
  -> COMMIT
```

Unique attempt and assertion digests reject concurrent or replayed callbacks.
SQLite busy handling is bounded; exhaustion returns unavailable and creates no
partial session. Expiry cleanup may delete terminal rows only after their
replay windows close and must never make a digest reusable.

The database is local runtime state, not publication history. Restart preserves
it through the Home volume. Recreating it signs out all operators. Restoring an
older copy is forbidden because it could remove revocation or consumption
records.

## 6. Public Read

```text
GET /channels/<channel>/latest.pb
GET /snapshots/<channel>-<20-digit-sequence>.pb
```

Response:

```text
Content-Type: application/protobuf
ETag: "<envelope_sha256>"
X-Content-Type-Options: nosniff
```

Latest is revalidated; immutable sequence reads are one-year cacheable.
`If-None-Match` returns 304 without a body.

## 7. Client State

```text
XConfigCache
  channel
  signing_key_id
  sequence
  statement_sha256
  signed_envelope_bytes
  accepted_at
  expires_at
  etag?

XConfigOriginSet (channel-scoped, XCFG-D06)
  advertised_origins[]   # last accepted snapshot's distribution section
  active_origin?         # origin of the currently accepted snapshot
  updated_at

Bootstrap origin sources merged per refresh (first occurrence wins,
effective fetch list capped at 8 after admission):
  PEERS_X_CONFIG_URL (dev override)
  ++ advertised_origins (signed, <=4)
  ++ baked PT_DIST_X_CONFIG_URLS (package anchors, pinned)

StationSuggestion
  seed_id
  kind
  display_name
  connection_material
  regions[]
  freshness
  actionable
  source_sequence
```

The secure watermark is `(channel, sequence, statement_sha256, signing_key_id)`.
Cache persistence precedes watermark advancement. Advertised origins persist
only after the same signed acceptance; unsigned origin mutation is impossible.
Cloud refresh never mutates verified Station entries, active route, Session,
Actor, Device, or Federation scope.

## 8. State Machines

### 8.1 Publication

```text
draft
  -> validated
  -> diff_acknowledged
  -> repository_cas
  -> statement_built
  -> signed
  -> atomically_persisted
  -> publicly_readable

validated -> rejected
repository_cas -> conflict
statement_built -> signing_failed
signed -> persistence_failed
```

There is no waiting approval, external publisher, preview artifact promotion,
or independent ledger state.

### 8.2 Client Refresh

```text
ready_local
  -> origin_list_built      # override ++ advertised ++ baked, validated
  -> fetching(origin[0])
  -> verifying
  -> accepted
  -> origins_persisted
  -> ready_current

fetching(origin[i]) -> origin_unreachable -> fetching(origin[i+1])
fetching(last) -> backoff -> ready_local
verifying -> rejected -> fetching(next origin) | ready_local
accepted -> persistence_failed -> ready_local
```

A refresh round only succeeds on a snapshot that passes keyring and watermark
checks; individual origin failures never replace the current snapshot.

## 9. Error Model

```text
x_config_draft_not_found
x_config_draft_conflict
x_config_validation_failed
x_config_publication_not_found
x_config_repository_unavailable
x_config_signature_invalid
x_config_key_unknown
x_config_channel_mismatch
x_config_expired
x_config_rollback
x_config_sequence_conflict
x_config_persistence_failed
operator_attempt_consumed
operator_assertion_replayed
operator_session_required
operator_session_revoked
operator_csrf_invalid
operator_store_unavailable
```

Errors contain no credentials, private key bytes, full session identifiers, or
raw sensitive payloads.
