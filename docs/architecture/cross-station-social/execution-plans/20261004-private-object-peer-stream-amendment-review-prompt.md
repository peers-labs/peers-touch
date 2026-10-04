# Federated Private Object Peer Stream Amendment Review

> **Status**: accepted
> **Version**: v1.1
> **Created**: 2026-10-04 | **Updated**: 2026-10-04
> **Owner**: Social / Federation

---

## 1. Review Scope

Review proposed `CSS-D11` across:

- `docs/architecture/cross-station-social/design.md`
- `docs/architecture/cross-station-social/decisions.md`
- `docs/architecture/cross-station-social/data-model.md`
- `docs/architecture/cross-station-social/integration.md`
- `docs/architecture/secure-content/decisions.md` (`SC-D18`, `SC-D29`)
- `docs/architecture/cross-station-social/execution-plans/20261003-native-private-social/plan.md`
- `docs/architecture/cross-station-social/execution-plans/20261003-native-private-social/tasks/CSS-03-private-media.md`

## 2. Verified Evidence

- Source Social already owns encrypted object bytes, descriptors, endpoint and
  recovery grants, current resource authorization, and bounded range reads.
- Recipient Social already persists the viewer-scoped remote resource,
  Federation and Station identities, lifecycle revision, object descriptors,
  and the SHA-256 of the canonical imported delivery.
- Desktop already fetches media only from its Home Station and verifies
  descriptor headers, ciphertext integrity, AEAD plaintext, and plaintext hash.
- Federation already supports authenticated unbuffered peer responses, but no
  Social private-object peer route or scope is registered.
- `ReadFederatedPrivateObjectRequest.imported_grant_sha256` exists, but its
  canonical input is undefined.
- The current CSS-03 source Gate is false-green: the Go selector finds no
  `TestFederatedPrivateObject*` tests and the Vitest selector skips every test.

## 3. Proposed Decision: CSS-D11

### 3.1 Imported Grant Commitment

Add the proto messages `FederatedPrivateObjectGrantBinding`,
`FederatedPrivateObjectRange`, and
`ReadFederatedPrivateObjectResponse`:

```proto
message FederatedPrivateObjectGrantBinding {
  uint32 format_version = 1;
  string federation_id = 2;
  string delivery_id = 3;
  string source_station_peer_id = 4;
  string target_station_peer_id = 5;
  string target_actor_ptid = 6;
  peers_touch.model.secure_content.v1.SecureResourceRef resource = 7;
  uint64 lifecycle_revision = 8;
  string object_id = 9;
  bytes descriptor_sha256 = 10;
}

message FederatedPrivateObjectRange {
  uint64 start = 1;
  uint64 end_exclusive = 2;
}

message ReadFederatedPrivateObjectRequest {
  uint32 format_version = 1;
  string federation_id = 2;
  peers_touch.model.actor.v1.ActorDeviceRef viewer = 3;
  peers_touch.model.secure_content.v1.SecureResourceRef resource = 4;
  string object_id = 5;
  reserved 6, 7;
  reserved "range_start", "range_end_exclusive";
  bytes imported_grant_sha256 = 8;
  FederatedPrivateObjectRange range = 9;
}

message ReadFederatedPrivateObjectResponse {
  bytes descriptor_sha256 = 1;
  FederatedPrivateObjectRange range = 2;
  uint64 total_ciphertext_size = 3;
}
```

`imported_grant_sha256` is exactly:

```text
SHA-256(CanonicalProtoBytes(FederatedPrivateObjectGrantBinding))
```

A binding-specific
`CanonicalFederatedPrivateObjectGrantBindingBytes` validates every canonical
identifier, exact resource fields, positive lifecycle revision, and exact
32-byte descriptor digest, then delegates unknown-field rejection and
descriptor-order wire encoding to the existing Social `CanonicalProtoBytes`.
That encoder, not a protobuf runtime's deterministic marshal option, is the
normative algorithm: it rejects unknown fields and maps, traverses declared
fields in descriptor order, preserves list order, and emits canonical protobuf
wire values.

Go and Rust consume one checked-in known-answer vector rather than deriving
their own expected values. The first vector is:

```text
format_version: 1
federation_id: federation:test
delivery_id: federated-resource-0123456789abcdef0123456789abcdef
source_station_peer_id: station-source
target_station_peer_id: station-target
target_actor_ptid: ptid:bob
resource:
  owner_domain: SECURE_CONTENT_OWNER_DOMAIN_SOCIAL
  content_id: 01ARZ3NDEKTSV4RRFFQ69G5FAV
  generation: 7
lifecycle_revision: 9
object_id: object-01
descriptor_sha256: 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
canonical_bytes_hex:
  0801120f66656465726174696f6e3a746573741a336665646572617465642d7265736f757263652d3031323334353637383961626364656630313233343536373839616263646566220e73746174696f6e2d736f757263652a0e73746174696f6e2d7461726765743208707469643a626f623a200802121a303141525a334e44454b54535634525246465136394735464156180740094a096f626a6563742d30315220000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
sha256:
  a83df011373330c87213dedbd3553e869c897ff6e4120761153c04e494ba187b
```

`descriptor_sha256` is exactly:

```text
SHA-256(CanonicalDescriptorBytes(EncryptedObjectDescriptor, policy))
```

`storage_ref` participates because it is part of the immutable descriptor.
Neither route accepts `storage_ref` separately, and source Social always opens
the storage key from its own object row.

The binding is actor-scoped and intentionally excludes the viewer device and
requested range:

- one imported actor projection can authorize resumable range reads;
- immediately before every peer call, Recipient Social validates the
  authenticated viewer endpoint against its local Actor Identity authority;
- the resulting one-minute Federation token is the recipient Home Station's
  signed endpoint-liveness attestation for the exact actor/device/request;
- Source Social independently requires that exact actor/device to remain
  covered by an unrevoked endpoint or actor-recovery object grant;
- changing Federation, delivery, Station pair, actor, resource generation,
  lifecycle revision, object, or descriptor changes the commitment.

The receiver computes the commitment only from its durable imported projection
and selected descriptor. The source recomputes it from current source-owned
resource/object truth plus the deterministic per-actor delivery identity:

```text
delivery_id =
  deterministicPrivateID(
    "federated-resource",
    resource.content_id,
    target_actor_ptid,
  )
```

The existing `deterministicPrivateID` v1 algorithm is normative: hash the ASCII
domain prefix `peers-touch:social-private:federated-resource:v1\0`, then for
each value hash its base-10 byte length, one NUL byte, and the UTF-8 value;
return `federated-resource-` plus the lowercase hex of the first 16 digest
bytes.
The source lookup starts from `(resource, object_id)`, requires the attached
object and current Social resource, loads the canonical recipient-locality
snapshot persisted with that resource's source plan, and requires exactly one
entry for the request actor. The source derives `target_station_peer_id` from
that committed locality rather than from any caller-controlled claim, requires
it to equal the authenticated peer issuer and custom target claim, derives the
delivery ID, and only then constructs the binding. A missing, duplicate,
invalid, or mismatched locality is the same canonical `404` as other
authorization denial. A caller-provided digest is never accepted as
authorization by itself.

### 3.2 Peer Request Authentication

Add one
`POST /federation/social/private/objects/:object_id/read` route with a dedicated
`social-private-object-read` scope. The bounded protobuf request is carried in
the body with `Content-Type: application/protobuf`; the successful response is
raw `application/octet-stream`.

The route uses a canonical protobuf handler with a 4 KiB body limit. It retains
the original bytes, unmarshals with unknown fields preserved, performs the
binding-specific validation, canonicalizes through `CanonicalProtoBytes`, and
requires the canonical bytes to equal the original body byte for byte. This
rejects duplicate fields, non-minimal varints, explicit default values,
out-of-order fields, unknown fields, and any other wire alias before
authorization.

Reserve the existing scalar field numbers `6` and `7`, retain
`imported_grant_sha256 = 8`, and add one required
`FederatedPrivateObjectRange range = 9`. It is canonical only when:

```text
0 <= start < end_exclusive <= descriptor.ciphertext_size
end_exclusive - start <= 1_048_576 bytes
```

The peer operation has no full-body or open-ended variant. Recipient Social
normalizes the Native-facing request against the imported descriptor:

```text
absent Range       -> [0, total), outer status 200
bytes=start-end    -> [start, end + 1), outer status 206
bytes=start-       -> [start, total), outer status 206
```

Objects have positive total size. Closed-range `end + 1` overflow, `start >
end`, `start >= total`, `end >= total`, multiple ranges, and suffix ranges are
`416`. The normalized half-open interval is partitioned by repeatedly choosing
`partition_end = min(partition_start + 1_048_576, normalized_end)`, with
checked arithmetic and no gaps or overlap.

The peer token binds:

- Federation ID;
- source and target Station peer IDs;
- viewer actor PTID and device ID;
- object ID;
- SHA-256 of the deterministic `ReadFederatedPrivateObjectRequest`.

The route uses the existing peer-token convention with a one-minute maximum
TTL and a fixed five-second future clock-skew allowance:

```text
scope = social-private-object-read
iss = recipient/target Station peer ID
aud = source/object-authority Station peer ID
sub = viewer actor PTID
custom.federation_id = request.federation_id
custom.source_station_peer_id = aud
custom.target_station_peer_id = iss
custom.actor_ptid = request.viewer.actor.ptid = sub
custom.device_id = request.viewer.device_id
custom.object_id = path object ID = request.object_id
custom.canonical_request_sha256 =
  lowercase-hex(SHA-256(CanonicalProtoBytes(request)))
```

The scope allowlist contains exactly those seven custom claim keys. Source
Social validates `scope`, `iss`, `aud`, `sub`, every custom claim, the request
body, path object ID, and its own local Station ID before any authorization or
range disposition. Federation verification requires exactly one audience,
present `iat` and `exp`, `0 < exp - iat <= 60 seconds`, `iat` no more than five
seconds in the future, and an unexpired `exp`. Tests cover missing/future
`iat`, multiple audiences, non-positive or overlong TTL, and expiry.

A valid token/request pair may be replayed during its lifetime because the
operation is read-only, but each replay revalidates current Federation
membership, committed recipient locality, resource authorization, descriptor,
and exact actor/device object grant. Source-side revoke takes effect
immediately through those checks. Recipient endpoint revocation after token
mint may remain accepted only for the token's remaining lifetime, bounded to
65 seconds including allowed clock skew; this bounded liveness window is an
explicit negative consequence of stateless peer authentication. Any product
requirement for immediate cross-Station endpoint revocation would require a
separate introspection or denylist decision.

The request digest covers the resource, object, requested range, and imported
grant commitment. Path object ID and protobuf object ID must match. The source
must also revalidate active Federation membership, the exact current
actor/device object grant, current resource authorization, exact descriptor,
and range before opening bytes. Source Social does not query recipient-local
Actor Identity state; Recipient Social owns that check and proves it through
the short-lived signed peer token.

### 3.3 Data Plane And Failure Semantics

- Recipient Social is the only Native-facing object route.
- Source Social is the only ciphertext/object and grant authority.
- Federation transports one bounded ciphertext range without placing it in a
  durable frame or protobuf response. Direct peer transport streams that
  range. Relay transport may buffer only that single range, capped at
  `ObjectChunkSize`; the Relay-client dispatcher must read at most
  `ObjectChunkSize + 1` and fail closed before constructing a response frame
  when oversized. The Relay-side pending request records a route-specific
  response payload limit. After reading the existing 10-byte frame envelope,
  the sole read loop uses its request ID to resolve that limit before allocating
  or reading the response payload. For this route the maximum response payload
  is `ObjectChunkSize + 8 KiB response headers + 12 bytes response framing`,
  exactly 1,056,780 bytes; the full frame is at most 1,056,790 bytes including
  the envelope. CSS-D11 adds `Cancel` and `Cancelled` control-frame types to the
  Relay protocol. Cancellation or timeout transitions the existing pending
  slot into `draining`, retains its route cap and semaphore admission, and sends
  `Cancel(request_id)` to the target relay-client. The relay-client cancels the
  local HTTP context; the per-request sender serializes the terminal choice and
  emits `Cancelled(request_id)` only after proving no Response frame can follow.
  A raced Response is read under the original cap and discarded, then clears
  the slot. A `Cancelled` acknowledgement also clears it. A request ID is never
  reused during one TCP stream lifetime, including after its terminal frame;
  before the 32-bit nonzero sequence would wrap, new admission stops, existing
  slots drain, and a fresh stream starts with a new sequence.

  Draining slots remain bounded by the existing per-Station concurrency limit.
  Rapid cancellation therefore rejects new admission when all slots are
  draining; it cannot overflow an auxiliary map or close a healthy shared
  stream. A draining slot that receives neither terminal frame within one
  additional `ForwardTimeout` proves the target stream unhealthy and triggers
  connection recycle. A never-registered request ID is discarded with a fixed
  scratch buffer up to the general Relay payload limit; it is never allocated
  as one payload or delivered to a caller. An oversized declared payload closes
  the malicious Station stream before allocation. Other routes retain the
  general Relay protocol limit.
- Recipient Social assembles sequential peer ranges into the existing
  Native-facing contract: full body returns `200`; one satisfiable closed or
  open-ended range returns `206`; invalid, multiple, suffix, or unsatisfiable
  ranges return `416`.
- Missing, unauthorized, stale grant, wrong actor/device/object/descriptor, and
  inactive membership are checked before range disposition, use one canonical
  peer `404` response, and return no bytes. Recipient Social never forwards the
  peer error body; it maps the result to the existing local non-disclosing
  private-object not-found shape.
- Peer timeout, disconnect, and source dependency failure are retryable and
  preserve object identity and partial-download checkpoint semantics.
- Every peer range must return `206`, `Content-Type: application/octet-stream`,
  `Accept-Ranges: bytes`, exact `Content-Length`, exact `Content-Range`, quoted
  SHA-256 `ETag`, `X-Descriptor-SHA256`, and
  `X-Total-Ciphertext-Size`. The source also emits a bounded
  `X-Peers-Social-Object-Metadata` header containing unpadded base64url of
  `CanonicalProtoBytes(ReadFederatedPrivateObjectResponse)`. The response
  metadata contains only the exact 32-byte descriptor digest, range, and total;
  its canonical decoded size is at most 69 bytes and encoded header value is at
  most 92 ASCII bytes. Recipient Social checks the encoded length before
  decoding, decodes with strict unpadded base64url, and requires unpadded
  re-encoding to equal the original header byte for byte; this rejects padding
  and non-zero trailing-bit aliases. It then rejects malformed encoding,
  decoded values over 69 bytes, non-canonical protobuf bytes, unknown fields,
  or disagreement with the other headers before forwarding that range. The
  complete response-header set remains inside the existing 8 KiB budget.
- Recipient Social validates the first peer response before committing outer
  headers. Outer `Content-Length`, `Content-Range`, status, and ETag describe
  the original normalized Native request, never one internal peer partition.
- Before client response commitment, retryable peer failures may be surfaced
  as the existing typed dependency failure. After any client header/body byte
  is committed, Recipient Social performs no transparent retry: it terminates
  the stream and Desktop resumes with a fresh exact range from its durable
  checkpoint.
- Direct cancellation closes the active peer response. Relay cancellation
  stops subsequent ranges and sends the protocol cancellation frame for the
  current bounded response. The relay-client closes the source HTTP response or
  cancels the in-flight source request before acknowledging cancellation.
- No read creates or mutates Social authority state.

### 3.4 Operability

Add:

- `social_cross_station_object_stream_total`
  labels: `stage`, `outcome`, `reason`
- `social_cross_station_object_stream_latency_seconds`
  labels: `stage`, `outcome`

Allowed stages are `recipient_proxy` and `source_read`. Allowed outcomes and
reasons are:

```text
outcome: accepted | rejected | interrupted | retryable
reason: none | not_found | range_invalid | integrity | dependency | cancelled
```

Actor, device, resource, object, range, payload, key, and Station identifiers
are forbidden in metric labels and logs.

Only a fresh peer-hop `X-Request-ID` UUID is forwarded for correlation.
Recipient Social never forwards or derives it from the Native caller's request
ID. One fresh UUID is reused for all peer partitions of the outer request so
direct and Relay source logs can correlate the bounded operation without
exposing actor, object, range, or Station identity. It is never trusted for
authorization or used as a metric label. Tests cover direct and Relay
preservation.

For the Social private-object route, Relay classifies the path before logging
and records only the fixed route category `social-private-object-read`, method,
outcome, and fresh peer-hop request ID. It never records the bound target path,
object ID, query, target Station peer ID, or response body. The Relay handler
implementation and tests are part of CSS-03; unrelated Relay route logging is
not changed by this decision.

### 3.5 API Ownership And Plan Amendment

The capability registry records:

```yaml
- id: federation.social.private_object.read
  domain_owner: station.federation
  truth_owner: social.private_object
  exposure: peer
  canonical_route:
    method: POST
    path: /federation/social/private/objects/:object_id/read
  request_proto: peers_touch.model.social.v1.ReadFederatedPrivateObjectRequest
  response_proto: peers_touch.model.social.v1.ReadFederatedPrivateObjectResponse
  truth_stores:
    - social_private_content_posts
    - social_private_content_comments
    - social_private_objects
    - social_private_object_grants
  allowed_dependencies:
    - federation.auth.verify
    - federation.membership.read
    - social.private_object.read
  forbidden_aliases: []
  superseded_symbols: []
```

The route has no Conversation, client-visible, public OSS, or alternate
Federation alias.

CSS-03 moves these paths into its write set:

- `model/domain/social/private_federation.proto`;
- the scoped proto generator and generator tests;
- generated Station Go, Desktop TypeScript, and generated-only Mobile
  TypeScript outputs;
- Desktop and Mobile Rust proto consumers.
- `apps/station/frame/core/plugin/native/subserver/relay-client` and its tests;
- `apps/station/frame/core/plugin/native/subserver/relay/handler_station.go`
  and focused Relay tests;
- `tooling/acceptance/fixtures/social/federated-private-object-grant-binding-v1.json`;
- `tooling/scripts/check-social-private-media-source.mjs` and its tests.

The checked-in fixture above is the single source of the known-answer input,
195-byte canonical hex, and SHA-256 shown in section 3.1. Go and Rust tests load
that same file; no consumer constructs its own expected digest.

`check-social-private-media-source.mjs` owns this exact required test manifest:

```text
Node:
  secure-content generator preserves federated private object reservations and parity
  private-media source runner rejects missing skipped duplicate and zero-result tests
Go:
  TestFederatedPrivateObjectGrantBindingKnownAnswer
  TestFederatedPrivateObjectProtoReservations
  TestFederatedPrivateObjectRequestRejectsNonCanonicalWire
  TestFederatedPrivateObjectMetadataHeaderCanonicalBounds
  TestFederatedPrivateObjectMetadataHeaderRejectsNonCanonicalBase64URL
  TestFederatedPrivateObjectSourceReadAuthorizesAndStreamsRange
  TestFederatedPrivateObjectSourceReadRejectsClaimMismatch
  TestFederatedPrivateObjectSourceReadRejectsThirdStation
  TestFederatedPrivateObjectSourceReadRejectsInvalidTokenTemporalClaims
  TestFederatedPrivateObjectRecipientRejectsRevokedEndpointBeforeMint
  TestFederatedPrivateObjectDenialsReturnCanonicalNotFound
  TestFederatedPrivateObjectRecipientProxyPartitionsAndValidatesHeaders
  TestFederatedPrivateObjectRelayRejectsOversizedResponse
  TestFederatedPrivateObjectRelayRejectsOversizedFrameBeforeAllocation
  TestFederatedPrivateObjectRelayCancellationAcknowledgementReleasesSlot
  TestFederatedPrivateObjectRelayLateCancelledResponseKeepsSharedStream
  TestFederatedPrivateObjectRelayCancellationSaturationRejectsWithoutDisconnect
  TestFederatedPrivateObjectRelayRequestIDWrapRequiresNewStream
  TestFederatedPrivateObjectRelayRedactsLogs
Rust:
  social::private_media::tests::federated_private_object_grant_binding_known_answer
  social::private_media::tests::federated_private_object_metadata_rejects_noncanonical_base64url
  social::private_media::tests::remote_private_media_resume_preserves_object_identity
  social::private_media::tests::remote_private_media_rejects_descriptor_mismatch
Vitest:
  renders remote private image from home station
  renders remote private video retry state without direct remote URL
```

The runner first executes proto generator unit tests and
`proto-gen-secure-content.mjs --check`, then performs machine-readable
discovery and result parsing for every listed test. It also runs Desktop and
Mobile Rust compile checks because both `build.rs` consumers compile the shared
IDL. It fails when any expected name is absent, duplicated, skipped, filtered
out, not compiled, or when any language reports zero selected tests or zero
terminal results. The CSS-03 Gate runs this manifest runner before package
checks; a green empty filter is impossible.

The reviewed CSS-03 Task Slice is amended in the same candidate change: its
write set includes the proto, scoped generator/tests, generated Go/Desktop
TypeScript/Mobile TypeScript outputs, both Rust build consumers, fixture,
Federation auth/Social/Relay paths, operability checker, and this runner; its
sole source check invokes the runner and then API ownership, operability, and
`git diff --check`. The old regex-filter Gate is removed.

Metric emission uses typed constant values and one validated helper. The valid
matrix is:

| Stage | Outcome | Reasons |
|---|---|---|
| `recipient_proxy` | `accepted` | `none` |
| `recipient_proxy` | `rejected` | `not_found`, `range_invalid`, `integrity` |
| `recipient_proxy` | `interrupted` | `cancelled` |
| `recipient_proxy` | `retryable` | `dependency` |
| `source_read` | `accepted` | `none` |
| `source_read` | `rejected` | `not_found`, `range_invalid`, `integrity` |
| `source_read` | `interrupted` | `cancelled` |
| `source_read` | `retryable` | `dependency` |

The operability Gate rejects direct metric calls outside that helper and
unknown or dynamically derived stage/outcome/reason values.

## 4. Required Findings-First Review

Return `PASS` or `HOLD` with exact source references. Verify:

1. The grant commitment is deterministic and independently recomputable on
   both Stations.
2. Excluding device and range does not weaken authorization because both are
   separately bound and revalidated.
3. The digest cannot become a bearer token or substitute for current source
   authorization.
4. Source and recipient responsibilities remain single-owner and no second
   object store or public URL is introduced.
5. The peer scope binds all request dimensions needed to prevent cross-actor,
   cross-device, cross-object, cross-range, cross-Station, and cross-Federation
   replay.
6. Range, cancellation, retry, and response-header validation are complete and
   bounded.
7. Failure mapping remains non-disclosing and distinguishes terminal denial
   from retryable source outage.
8. Metrics and logs are bounded and privacy-safe.
9. The CSS-03 Task must add proto/codegen parity and real non-empty Go, Rust,
   and Vitest assertions before it may become `SOURCE_READY`.
10. Native product readiness remains `UNPROVEN` until CSS-08A and CSS-09.

## 5. Alternatives To Challenge

- Hash the entire imported delivery and require source outbox retention.
- Treat any 32-byte imported digest as sufficient proof.
- Bind the commitment to a single range or endpoint.
- Copy ciphertext objects to recipient Social.
- Let Desktop call the remote Station directly.
- Reuse Conversation attachment routes or public OSS URLs.
- Claim Relay is unbuffered or cancellation-propagating without changing it.

## 6. Required Output

```text
Verdict: PASS | HOLD

Findings:
- severity
- exact source reference
- violated invariant or missing semantic
- required correction

Decision checks:
- commitment determinism and replay binding: PASS | HOLD
- source authorization and ownership: PASS | HOLD
- stream/range/cancellation semantics: PASS | HOLD
- privacy-safe operability: PASS | HOLD
- CSS-03 plan amendment readiness: PASS | HOLD
```

A `PASS` accepts `CSS-D11` for architecture and execution-plan amendment. It
does not establish implementation completion, `SOURCE_READY`, schema
activation, Native product readiness, or Acceptance proof.

## 7. Review Outcome

Accepted on 2026-10-04 after independent security, protocol, and Relay
data-plane reviews returned `PASS`. Implementation and product evidence remain
subject to the amended CSS-03 source Gate and later CSS-08A/CSS-09 closures.
