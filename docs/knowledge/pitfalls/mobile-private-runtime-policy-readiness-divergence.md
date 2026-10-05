---
kind: pitfall
title: Mobile private runtimes must share policy, readiness, and Station wire contracts
status: active
owns:
  - apps/mobile/src-tauri/src/secure_content/
  - apps/mobile/src-tauri/src/station_origin.rs
  - apps/mobile/src/runtimes/privateMomentsRuntime.ts
  - apps/mobile/src/runtimes/privateMomentsRuntime.test.ts
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/client/mobile/lifecycle.md
  - docs/architecture/shared/security/secure-content/decisions.md
detected: 2026-09-27
---

# Mobile private runtimes must share policy and readiness

## Symptom

The exact-source iOS Secure Content Journey reached an authenticated shell, and
the lifecycle snapshot reported every runtime as `ready`, but the first private
Moment publish failed with:

```text
mobile.privateSocial.runtimeInactive
```

A direct native diagnostic exposed the hidden activation error:

```text
private Social first-use trust requires HTTPS or loopback HTTP
```

The same Journey later reached an authenticated `ACTIVE` scope after a lifecycle
restart while `private-social` remained inactive with no local error.

A direct Native activation probe then returned HTTP `200` with stable code
`20005` while loading `/actor/federation/me`.

After the wire contract was repaired, the runtime could report `active=true`
while its endpoint Content PreKeys were still absent. The first private publish
then reached `/api/v1/social/moments/prepare-private` without any preceding
Content PreKey inventory or publish request and failed with HTTP `500`, stable
code `20008`.

After endpoint provisioning was repaired, Mobile still maintained only the
endpoint pool. Private prepare requires one endpoint PreKey per recipient
device and one actor-recovery PreKey per recipient actor, so the first private
publish again failed with stable code `20008` even though endpoint readiness
was positive.

When reconciliation was moved ahead of readiness, every exact-source iOS
activation failed instead. Mobile generated a `mobile-cpk-publish-*` command ID
from ordinary protobuf bytes, while Station requires the canonical
`cpk-pub-v1-*` identity derived from deterministic shared bytes.

After publish-result reconciliation was added, an iOS run could still remain
inside `UNKNOWN_OUTCOME` until the 120-second Fixture deadline. The initial
submit had committed remotely, but the Mobile worker retried submit before
checking the authoritative resource readback, so it never consumed the
already-committed result and the Fixture handler could not quiesce cleanly.

A later W9 run reached a successful private publish but could observe only
`AUDIENCE_REQUIRED`, `CHECKING_PRIVATE_READINESS`, and `PUBLISHED`. Mobile's
one-shot Native command claimed recipient PreKeys, built and persisted the
encrypted request, dispatched it, and returned only the terminal projection.
The web runtime therefore had no source-owned boundary at which to project
`READY_PRIVATE`; treating the persisted request as ordinary `Pending` would
also let background reconciliation publish it before the user's explicit
submit action.

A later exact-source iOS replay repeated the same timeout after readback-first
reconciliation landed. Mobile sent `Accept: application/protobuf` on typed GET
requests but omitted `Content-Type: application/protobuf`. Station's typed
handler selects its response serializer from the request Content-Type, so it
returned protobuf JSON. Mobile decoded the body as binary protobuf, treated the
readback as unavailable, and kept the committed submission in
`UNKNOWN_OUTCOME`.

A later iOS replay reached an active lifecycle scope and an active Private
Social runtime, then the first public Moment mutation failed with
`MOBILE_WRITE_ADMISSION_CLOSED`. The Session or Social ingress admission could
still be reopening after the post-login restart even though both higher-level
readiness projections were already active.

## Root cause

Private Social implemented its own Station-origin policy instead of consuming
the shared Mobile policy. It therefore rejected the approved non-loopback HTTP
development origin that Messaging and Station identity already admitted.
Its session-transition queue also caught activation failures internally rather
than publishing them through the lifecycle readiness owner, so the graph
reported `private-social` as ready while its business scope was inactive.

Private Social also declared degradable `messaging` and `social` capabilities as
hard lifecycle dependencies. A timeout or bootstrap failure in either sibling
therefore skipped `private-social.bootstrap()` entirely during restart. Because
the descriptor never ran, its module snapshot remained the empty inactive state
without an activation error.

After those lifecycle defects were fixed, Mobile still decoded
`/actor/federation/me` as a raw `FederationSelfView`. The Station route and
Desktop client use the canonical `PeersResponse` envelope with an exact
`google.protobuf.Any` type URL, so the successful HTTP response failed local
protobuf decoding before Private Social could pin the Station signing key.

Native activation creates and binds the Private Social engine, but endpoint
Content PreKey provisioning belongs to Native reconciliation. The mobile
lifecycle published readiness immediately after activation and snapshot
loading, so a caller could publish before the first reconciliation.

The Mobile worker also implemented endpoint maintenance as a special case and
never inspected the stored recovery-master keyring. It therefore had no path to
query, rotate, replenish, or report the actor-recovery pool required by
`SC-D05`. Persisting derived recovery private keys would also violate
`SC-D20`; they must be derived on demand from the epoch master and key ID.

Mobile then duplicated the Content PreKey publication encoder and command-ID
derivation instead of consuming `secure-content-core`. The Station correctly
rejected that noncanonical command before committing any endpoint PreKeys, so
the lifecycle remained inactive even though the authenticated runtime graph
itself was otherwise healthy.

For private Moment submissions, the worker treated a prior
`UNKNOWN_OUTCOME` like a first dispatch. It resubmitted first and queried the
resource only after another successful response. That inverted the accepted
recovery order: authoritative readback must be checked before retrying a
may-commit command.

Mobile's private Social transport also diverged from Desktop's protobuf
content-negotiation helper. Its POST requests carried both request and response
media types, while GET requests carried only `Accept`. This is insufficient for
the current Station typed-handler contract, which uses request Content-Type to
select binary protobuf responses.

Private publish readiness and durable admission were also collapsed into one
operation. A prepared encrypted request had no distinct durable state, so
either the web layer had to invent readiness or the worker had to treat
readiness as permission to submit. Tests hid the gap by manufacturing the full
visible-state set in fixture snapshots instead of deriving it from production
actions.

The Mobile runtime owner also treated active lifecycle and Private Social
projections as sufficient mutation readiness. Those projections do not replace
the dedicated `recovery.snapshot.writeAdmission` owner, which can remain closed
briefly while Session refresh or Social ingress reconciliation completes.

## Mitigation

### What was done in code

- Private Social transport now consumes the shared `StationOriginPolicy`:
  development builds admit canonical HTTP origins and release builds remain
  HTTPS-only.
- Private Social session transitions now use the generation-bound lifecycle
  readiness helper, wait for declared dependencies, and propagate current-scope
  activation failures.
- Private Social hard dependencies are limited to `session` and
  `secure-storage`. Messaging and Social remain degradable sibling capabilities;
  their failure cannot suppress Private Social activation.
- The Federation self trust request decodes the canonical `PeersResponse`
  envelope and requires the exact `FederationSelfView` type URL. The separate
  Federation profile route retains its raw protobuf response contract.
- Private Social lifecycle bootstrap now completes Native reconciliation before
  publishing the runtime as active. Reconciliation failure fails lifecycle
  readiness and tears down the exact Native generation.
- Native reconciliation maintains endpoint and actor-recovery pools
  independently. Recovery public keys are deterministically derived from the
  exact stored epoch master, while only the canonical publication command is
  persisted; per-key recovery private material is never stored.
- The worker report exposes endpoint and optional recovery availability.
  Lifecycle readiness rejects an empty configured pool and the Acceptance
  projection preserves both counts.
- Mobile Content PreKey publication now uses the shared canonical encoder for
  both the proof-free request hash and the final wire bytes, and derives the
  same `cpk-pub-v1-*` command ID as Desktop and Station.
- A private Moment submission in `UNKNOWN_OUTCOME` now queries the exact
  content resource first. A valid signed readback commits the local projection;
  only an unavailable readback falls through to exact command resubmission.
- Every private Social protobuf request, including bodyless GET requests, now
  sets both `Content-Type: application/protobuf` and
  `Accept: application/protobuf`.
- Private text publication now persists a distinct `Prepared` submission after
  the one and only Station prepare/PreKey claim. `Prepared` is excluded from
  background reconciliation and becomes dispatchable only through the explicit
  submit command. The web runtime projects `READY_PRIVATE` only from that
  Native result, then projects `PUBLISHING` around the explicit submit.
- Typed Station private-content error details are retained through the Mobile
  transport so unsupported audience and recipient-key failures map to their
  exact visible states instead of a generic failure.
- The Mobile runtime owner polls the public recovery projection after key
  reconciliation and does not hand the client to a mutating Fixture until
  `writeAdmission.open` is true. Timeout diagnostics retain the last public
  admission reason without exposing credentials.
- Focused Rust and TypeScript regressions cover both policy modes and failed
  activation readiness.

### What guards against regression

- `private_social_uses_the_shared_station_origin_policy` verifies development
  HTTP admission and release HTTP rejection.
- `publishes activation failure through lifecycle readiness` verifies that a
  failed native activation cannot resolve bootstrap as ready.
- `restarts independently of failed degradable messaging and social runtimes`
  verifies that an authenticated restart still activates Private Social when a
  degradable sibling fails.
- `federation_self_request_decodes_peers_response_envelope` verifies the real
  HTTP request path, Bearer/device headers, canonical envelope, and exact
  Federation self payload type.
- `publishes readiness only after Content PreKey reconciliation` verifies that
  activation cannot become ready before Native provisioning succeeds, and
  `rejects readiness when a configured recovery pool is empty` verifies that
  endpoint-only readiness cannot hide a missing recovery pool.
- `recovery_publication_derives_keys_without_persisting_private_material`
  verifies Mobile recovery-publication derivation and the no-private-key
  persistence boundary.
- `content_prekey_publication_matches_the_shared_canonical_vector` verifies the
  Mobile wire bytes and command ID against the shared cross-platform vector.
- `unknown_submission_reads_authoritative_resource_before_retry` verifies that
  reconciliation probes the exact content identity before resubmission.
- `private_social_proto_requests_declare_request_and_response_media_types`
  verifies the shared Mobile request helper used by point readback and trust
  lookups.

## How to detect a recurrence

Run:

```bash
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  private_social_uses_the_shared_station_origin_policy
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  federation_self_request_decodes_peers_response_envelope
pnpm --dir apps/mobile exec vitest run \
  src/runtimes/privateMomentsRuntime.test.ts
```

Then inspect Mobile Station-origin validation and session transition owners:

```bash
rg -n "StationOriginPolicy|runRuntimeSessionTransition|FEDERATION_SELF_TYPE_URL" \
  apps/mobile/src-tauri/src/secure_content \
  apps/mobile/src/runtimes/privateMomentsRuntime.ts
```

Private Social must not add a parallel transport policy or swallow a
current-scope activation failure outside lifecycle readiness. Station routes
that return `PeersResponse` must not be decoded as their raw payload type.
An `active=true` lifecycle projection without an initial
`privateSocialReconcile` is also invalid. When a recovery master is configured,
the report must show positive endpoint and actor-recovery availability before
private prepare; endpoint-only readiness is insufficient.
Mobile must not derive Content PreKey publication identities from ordinary
protobuf encoding or introduce a client-specific command prefix.
An `UNKNOWN_OUTCOME` private Moment must never be blindly resubmitted before
the exact content resource has been queried and cryptographically verified.
The readback request must negotiate binary protobuf with both request
Content-Type and response Accept headers; `Accept` alone does not satisfy the
Station typed-handler contract.
A readiness-only private publish must remain in durable `Prepared`, must not
appear in `pending_submissions()`, and must not be sent by reconciliation.
Retrying prepare must reuse the same stored encrypted request; only explicit
submit may acquire it for dispatch. Fixture tests must return per-action
production histories and must fail if a required state is absent.
Native runtime owners must also observe
`recovery.snapshot.writeAdmission.open=true` after post-login restart and key
reconciliation before invoking any mutating Fixture action.

## Crosswalks

- `docs/client/mobile/lifecycle.md` defines debug/release Station-origin policy
  and generation-bound asynchronous runtime readiness.
- `SC-D22` requires W9 Mobile product proof to use the real production runtime
  path on the exact source.
