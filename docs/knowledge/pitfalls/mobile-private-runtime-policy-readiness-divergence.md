---
kind: pitfall
title: Mobile private runtimes must share policy, readiness, and Station wire contracts
status: active
owns:
  - apps/mobile/src-tauri/src/secure_content/
  - apps/mobile/src-tauri/src/station_origin.rs
  - apps/mobile/src/features/social/mobileSocialFacade.ts
  - apps/mobile/src/pages/moments/MomentCommentsSection.tsx
  - apps/mobile/src/runtimes/privateMomentsRuntime.ts
  - apps/mobile/src/runtimes/privateMomentsRuntime.test.ts
  - apps/mobile/src/runtimes/runtimeRegistry.ts
  - apps/mobile/src/runtimes/runtimeRegistry.test.ts
  - apps/mobile/src/services/gateways/momentsGateway.ts
  - apps/mobile/src/services/mobileCommands.ts
  - apps/station/app/subserver/social/application/federated_private_interaction.go
  - tooling/acceptance/gates/social/cross_station_mobile_desktop_e2e.py
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
`20005` while decoding the actor identity response.

An exact-source Desktop-to-iOS private Moment was later accepted and delivered
by both Stations, but Mobile could not decrypt it. Sender-profile resolution
returned HTTP `200` with stable code `20005` because Mobile decoded the strict
typed `/actor/federation/resolve` response as a `PeersResponse` envelope.

After that decoder was corrected, the same receiver still reported
`private Social sender Home Station profile is unavailable`. Mobile required
the sender to be local before loading a Profile and ignored the
`receiver_verified_sender_signing_key` that the receiver Station had already
bound to the imported resource.

After cross-Station reads passed, the first Mobile private Comment appeared
submitted in the UI but never converged. The source Station rejected
`PREPARE_COMMENT` because Mobile sent an empty actor signing-key ID and device
signature, while Mobile Reactions already used the required interaction
signature transcript.

Once prepare signatures were present, the source Station committed the plan
and the receiver Station returned it, but Mobile still never submitted the
Comment. Mobile required the source-signed plan key ID to equal its local
pinned Station key and ignored the receiver Station's localized signing-key
attestation.

Cross-Station prepare also resolves asynchronously. Its first HTTP attempt can
return an unknown dependency result while the exact command is in flight. The
UI retry path generated a fresh draft ID, so it could not replay the resolved
prepare command and instead consumed another command identity.

After the draft identity was retained, an immediate retry could still precede
the Federation result. Both attempts then returned pending even though the
source committed exactly once and the receiver resolved the result shortly
afterward.

After bounded retry pacing was added, prepare and submit both committed exactly
once and the receiver resolved both results, but Mobile still retained the old
`20008`. The receiver localized the source proof-key attestation while
importing the Comment projection, yet the submit HTTP replay returned the
unmodified source response.

Once Comment convergence passed, the private Reaction button produced no
durable command. The visible non-Public Post remained in the facade projection
while the current Private Runtime read projection was temporarily absent, so
the generic Reaction intent incorrectly fell through to the Public gateway.

Source-bound UI evidence later showed the Reaction handler did execute, but
Tauri rejected `deviceId` as an unknown field. The TypeScript adapter reused a
broad account scope while Rust Reaction inputs deliberately deny unknown
fields.

After the Reaction wire contract was corrected, bidirectional publication,
Comment, Reaction, and unauthorized-denial proof all passed. The mixed Gate
then timed out on revocation even though Mobile had already projected
`DELETED_OR_REVOKED`; its next point-read correctly failed with
`mobile.privateSocial.deletedOrRevoked`.

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

After those lifecycle defects were fixed, Mobile still decoded the actor
identity response as a raw payload. The canonical `/actor/profile` route uses
the `PeersResponse` envelope with an exact `google.protobuf.Any` type URL, so
the successful HTTP response failed local protobuf decoding before Private
Social could pin the Station signing key.

Mobile later applied that envelope decoder too broadly. Federation resolve is a
strict typed handler and returns its declared protobuf response directly, like
Desktop's canonical client. Treating it as `PeersResponse` made valid
cross-Station sender identity look malformed.

The sender-key resolver then retained a same-Station-only assumption. For an
imported private resource, the viewer's Home Station is the authority that
verifies and projects the retained source-device key. Requiring a local sender
Profile discarded that explicit cross-Station proof path.

Private Comment prepare and submit also bypassed the shared federated
interaction signing contract. Same-Station execution did not expose the gap,
but source-authority dispatch correctly rejected the unsigned cross-Station
command before mutation.

Federated prepare returns a source-signed plan plus an attestation issued by
the receiver's pinned Station for that retained source proof key. Verifying the
plan directly with the local Station key rejected valid remote authority after
the transport had already completed.

Comment retry identity belongs to the original user action. Generating the
draft ID inside every send attempt turned a recoverable pending result into a
new mutation and defeated Station exact-replay semantics.

Exact replay does not make an asynchronous result synchronous. A real UI retry
must wait for the receiver result path and remain bounded; one immediate retry
is not evidence that the command failed.

Federated Comment prepare localized its source plan attestation before returning
the replayed response. Submit omitted the equivalent boundary, so Mobile
rejected the source Station attestation after the mutation had already
committed. Because that post-transport verification error did not overwrite
the stored transport failure, the UI continued to display the stale `20008`.

Reaction routing used Private Runtime state as its only ownership signal.
That state is authoritative for mutation, but a temporarily missing projection
cannot reclassify a visible non-Public Post as Public. The facade must recover
the authoritative private projection instead of changing mutation owners.
The fallback feed row may also omit audience metadata, so ownership cannot be
reconstructed from whichever same-ID row happened to win the latest merge.

The Reaction command adapter also passed lifecycle-only fields to a narrower
Rust mutation contract. Other commands silently ignored those fields, hiding
the schema drift until strict Reaction deserialization exercised it.

The mixed Gate used the access-open private point-read as both a resource read
and a terminal revocation observer. Private Runtime intentionally closes that
operation once a tombstone has entered its projection, so the Gate converted a
successful terminal state into an Appium transport failure. Reconciliation
snapshot state, not another content read, owns observation of that terminal
projection.

The Mobile Moments Gateway made the same mistake while reconciling a retained
Search detail. Its catch-all conversion turned the original Runtime's terminal
refusal into `PRIVATE_SOCIAL_READ_UNAVAILABLE`. The feed therefore reported a
failed Moments repair after every periodic reconciliation and kept mutation
admission closed even though all lifecycle runtimes were ready.

Social resume also reused any retained controller without checking the complete
admitted identity it captured. A Session update while the old lifecycle context
was fenced could skip the queued replacement, while Private Social activated
the current scope. The retained Moments Gateway then correctly rejected its
old session and Social repair never reopened. Registry identity also omitted
device and authentication generation. Separately, the Gateway mapped a trusted
`NOT_FOUND_OR_NOT_AUTHORIZED` read to unavailable instead of a hidden detail,
turning a valid original authority denial into another failed repair.

Private Runtime reconciliation also spread the empty fenced snapshot when
the original Native engine remained valid across a same-session fence. It
reloaded readable projections and reported lifecycle readiness while retaining
`active=false`, empty identity and activation zero. Direct reads used the valid
original scope, but Gateway admission rejected the inconsistent public
snapshot. Successful reconciliation must derive identity from its validated
original scope, not inherit it from a cleared presentation snapshot.

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

- Private Social transport now consumes the shared Station-origin normalizer.
  Every build accepts the user's canonical HTTP or HTTPS choice; scheme
  selection does not replace signed Station identity or route verification.
- Private Social session transitions now use the generation-bound lifecycle
  readiness helper, wait for declared dependencies, and propagate current-scope
  activation failures.
- Private Social hard dependencies are limited to `session` and
  `secure-storage`. Messaging and Social remain degradable sibling capabilities;
  their failure cannot suppress Private Social activation.
- The actor identity trust request reads `/actor/profile`, decodes the canonical
  `PeersResponse` envelope, and requires the exact `ActorProfile` type URL. The
  public Federation profile route retains its raw protobuf response contract.
- Remote sender resolution first reads active Federation contexts and sends an
  explicit `federation_id` on every `/actor/federation/resolve` request. It
  decodes that strict typed route as the raw `FederationResolveView`, never as a
  `PeersResponse` envelope.
- Private Moment, recovery, and Comment reads validate the receiver Station's
  bounded `receiver_verified_sender_signing_key` before any local Profile
  fallback. The key must match the sender endpoint, signing-key ID, commit
  time, verification source, and expected Home Station when the response
  exposes one.
- Private Comment prepare/submit and Reaction/unreaction share one
  `peers-touch:social:federated-private-interaction:v1` signing transcript.
  Mobile signs the exact operation bytes with its active device key and the
  transport rejects empty key IDs or non-64-byte signatures before dispatch.
- Private Comment plan verification uses the local pinned Station key only for
  local plans. A remote plan must carry a localized
  `StationContentSigningKeyAttestation`; Mobile verifies that attestation with
  the pinned Station key, then verifies the source plan with the attested proof
  key.
- The Mobile Comment composer retains one draft ID while an entered comment is
  pending or failed. The visible retry action reuses that ID and the same
  prepare command; only committed success or Post change clears it.
- The mixed Desktop/iOS Gate exercises the visible retry action with bounded
  `1/2/4` second backoff. Every attempt retains the same draft and command
  identity, and exhaustion reports only sanitized draft state.
- The receiver Station localizes the source Comment proof-key attestation in
  the replayed submit response, just as it already localizes prepare plans.
  Mobile therefore verifies the committed response against its pinned Home
  Station without weakening source proof verification.
- A visible non-Public Post is always owned by Private Social. If its current
  read projection is absent, the facade rehydrates it through
  `readPrivateMoment` before mutating and never falls through to the Public
  Reaction gateway. The facade retains every Private Runtime-proven canonical
  Post ID for its session lifetime so a same-ID fallback row cannot erase
  mutation ownership. Ownership hints are account-scoped (same Station and
  Actor) and may come from Post, Comment draft, Comment, or Reaction command
  artifacts. The bounded ID-only registry survives facade recreation, while
  projection content remains device/generation-scoped.
- React, unreact, and retry adapters serialize only
  `stationPeerId`, `actorPtid`, `activationGeneration`, and their exact command
  fields. `deviceId` and `lifecycleGeneration` remain lifecycle inputs and
  never cross the strict Reaction command boundary.
- The mixed Desktop/iOS Gate observes `DELETED_OR_REVOKED` and retained
  `NOT_FOUND_OR_NOT_AUTHORIZED` from the sanitized reconciliation snapshot.
  It calls the access-open point-read only while no matching terminal
  projection exists, and still requires receiver-visible feed absence plus
  restart non-resurrection.
- The Mobile Moments Gateway checks its current authenticated session and exact
  Native activation before observing a matching `DELETED_OR_REVOKED` projection.
  It returns a payload-free `PostDetailOutcome.DELETED` without another private
  content read. Missing projections, unavailable reads and stale sessions still
  fail; the original Runtime's content, media and mutation refusals remain closed.
- Social resume reuses its retained controller only when its recorded complete
  identity matches the current admitted session. A replacement tears down and
  drains before starting under the current readiness context. Registry identity
  uses the shared Station/Actor/device/generation scope plus session ID.
- A trusted original `NOT_FOUND_OR_NOT_AUTHORIZED` read maps to a payload-free
  hidden detail without comment reads or an inferred deletion. Authentication,
  recovery and integrity failures remain unavailable; stale Gateway rejection
  is unchanged.
- Successful current-scope Private Social reconciliation republishes active,
  Station, Actor, device, authentication generation and Native activation from
  its original scope. Failed or superseded operations cannot reopen it.
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

- `private_social_uses_the_shared_user_selected_station_origin_policy` verifies
  canonical HTTP and HTTPS admission plus malformed-origin rejection.
- `publishes activation failure through lifecycle readiness` verifies that a
  failed native activation cannot resolve bootstrap as ready.
- `restarts independently of failed degradable messaging and social runtimes`
  verifies that an authenticated restart still activates Private Social when a
  degradable sibling fails.
- `actor_profile_request_decodes_peers_response_envelope` verifies the real
  HTTP request path, Bearer/device headers, canonical envelope, and exact Actor
  Profile payload type.
- `federation_resolve_decodes_the_strict_typed_raw_response` verifies the
  context lookup plus Federation resolve request sequence, protobuf media
  headers, and raw typed response contract.
- `receiver_verified_remote_sender_key_precedes_profile_resolution` verifies
  that a valid remote source key is consumed without a local Profile request.
- `private_comment_transport_rejects_unsigned_interactions` verifies Comment
  prepare and submit cannot leave Mobile without the shared actor signature.
- `MomentCommentsSection.test.tsx` verifies that Comment retry reuses one draft
  identity and keeps a stable retry action selector.
- `test_cross_station_mobile_desktop_e2e.py` verifies that the mixed Gate waits
  for Federation result convergence and can repeat the same visible retry
  action without creating another command identity.
- `TestFederatedPrivateCommentSubmit` verifies that the replayed submit response
  carries a receiver-localized proof-key attestation bound to the original
  source proof key.
- `mobileSocialFacade.test.ts` verifies that a visible private Post with a
  temporarily absent runtime projection is rehydrated before Reaction and
  never reaches the Public gateway.
- `mobileCommands.test.ts` verifies the exact Tauri payload shape for React,
  unreact, and retry and rejects accidental lifecycle-field leakage.
- `test_cross_station_mobile_desktop_e2e.py` verifies that a reconciled terminal
  revocation projection is accepted without calling the access-open Mobile
  action.
- `persists ordered revocation and closes every private post operation` also
  runs the real Gateway and feed reconciliation against the original Runtime
  tombstone. Terminal detail repair succeeds without another Native read, while
  a same-actor session switch still rejects the old Gateway.
- `runtimeRegistry.test.ts` changes session, device and generation while the
  old context is fenced and requires ordered replacement instead of old-owner
  resume.
- `repairs a retained private detail from an original typed denial without comments`
  runs the real Private Runtime, Gateway and feed, requiring hidden detail,
  successful repair, retained denied projection and zero comment reads.
- `rebinds original scope metadata after a same-session projection fence on resume`
  retains the original Native activation, fences the projection, resumes and
  requires complete identity plus a successful real Gateway read.
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
  actor_profile_request_decodes_peers_response_envelope
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  federation_resolve_decodes_the_strict_typed_raw_response
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  receiver_verified_remote_sender_key_precedes_profile_resolution
pnpm --dir apps/mobile exec vitest run \
  src/runtimes/privateMomentsRuntime.test.ts
```

Then inspect Mobile Station-origin validation and session transition owners:

```bash
rg -n "StationOriginPolicy|runRuntimeSessionTransition|ACTOR_PROFILE_TYPE_URL" \
  apps/mobile/src-tauri/src/secure_content \
  apps/mobile/src/runtimes/privateMomentsRuntime.ts
```

Private Social must not add a parallel transport policy or swallow a
current-scope activation failure outside lifecycle readiness. Station routes
that return `PeersResponse` must not be decoded as their raw payload type.
Strict typed Station routes must remain raw protobuf and must not be decoded as
`PeersResponse`; route registration and the canonical Desktop client determine
which contract applies.
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
An Acceptance Gate must not probe a known deleted or revoked resource through
an operation whose production contract rejects terminal access. It may use the
sanitized runtime snapshot for supporting terminal-state observation only when
the same scenario still proves the receiver-visible absence and restart
behavior required by the Feature contract.
After Session resume, the Social controller's recorded identity must match
the current admitted session before it is reused. Device and authentication
generation changes cannot be ignored because Actor and session ID match.
An original typed not-found/not-authorized result is a hidden detail; it must
not become a transport failure or authorize old private content or comments.
After a same-session projection fence, successful Private Social reconciliation
must restore the original current scope metadata alongside fresh projections.
Lifecycle ready with `active=false` or activation zero is invalid even when a
direct Native read succeeds.

## Crosswalks

- `docs/client/mobile/lifecycle.md` defines user-selected Station-origin policy
  and generation-bound asynchronous runtime readiness.
- `SC-D22` requires W9 Mobile product proof to use the real production runtime
  path on the exact source.
