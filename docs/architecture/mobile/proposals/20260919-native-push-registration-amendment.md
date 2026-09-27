# MS-D23A PTID Push Registration And Reconcile Amendment

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Mobile Architecture Team
> **Module**: `model/domain/notification/`, `apps/station/app/subserver/notification/`, `apps/mobile/`

---

## 1. Scope

This amendment closes the protocol and ownership gaps that prevented W7 from
implementing MS-D23:

- PTID-only, device-bound APNs, FCM, and UnifiedPush registration;
- idempotent registration, unregister, authoritative readback, rotation, and
  invalid-provider cleanup;
- provider credential protection and response redaction;
- generation-fenced native token, receipt, and tap callbacks;
- bounded push payload and reconcile-only Mobile behavior.

It does not add Web Push, implement provider dispatch credentials, prove
physical provider delivery, or allow native callbacks to mutate business
truth. W7 source checks own deterministic callback fencing and reconcile
semantics; W7-PROOF owns installed simulator platform integration.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
| --- | --- | --- | --- | --- |
| PTID is the only actor identifier permitted across API and device boundaries | `verified_fact` | `docs/knowledge/invariants/actor-identity-boundary.md`; MS-D06 | high | none |
| Notification owns push policy and device registrations | `accepted_decision` | MS-D22, MS-D23; Mobile `design.md` | high | exact registration protocol |
| Native plugins own provider token acquisition and OS receipt/tap callbacks | `accepted_decision` | MS-D23 | high | exact native callback contract |
| Current Notification Proto has no push registration messages | `verified_fact` | `model/domain/notification/notification.proto` | high | none |
| The Notification architecture still specifies `actor_id`, token-bearing readback, and preview title/body payloads | `verified_fact` | `notification-architecture.md` push sections | high | canonical replacement |
| Station Notification has no push registration route, service, repository, or storage | `verified_fact` | Notification subserver source | high | implementation |
| Mobile has lifecycle and network callback fencing but no native provider registration surface | `verified_fact` | platform-permissions plugin; lifecycle/native event bridges | high | implementation |
| Acceptance-only synthetic push/tap emitters are not production native evidence | `verified_fact` | `commands/native_events.rs`; `platform/native_events.rs` | high | production callback path |
| Current authenticated Rust transport is allowlisted and keeps bearer credentials out of Web | `verified_fact` | `runtime/station_transport/mod.rs`; MS-D17 | high | push operations and native-only caller |

## 3. Source Of Truth And Ownership

| State or operation | Canonical owner | Required boundary |
| --- | --- | --- |
| Actor identity | Actor Identity / authenticated Station subject | `actor_ptid` only |
| Device identity | verified Mobile session and Actor Device | request `device_id` must equal authenticated device assertion |
| Provider token/endpoint acquisition | native iOS/Android plugin | opaque callback to Rust only |
| Active push registration | Notification | one active registration per actor/device/channel/environment |
| Provider credential plaintext | native plugin during callback and Notification dispatch adapter during send | never Web, logs, routes, projections, or readback |
| Lifecycle generation and callback ordering | Mobile Rust | native callback is accepted only for current generation and next sequence |
| Notification/read truth | Notification Station state | push only marks projection stale and requests reconcile |
| Navigation | Mobile navigation runtime after authoritative reconcile | push hint is advisory and scope-validated |

Forbidden relationships:

- Native or Web code cannot submit an actor identity for registration.
- Web code cannot receive, persist, log, or retry provider credentials.
- Notification cannot trust a body `device_id` without the authenticated
  device assertion.
- Push receipt, tap, or scheduled wakeup cannot mark read, advance a cursor,
  complete a command, or create a business object.
- Provider payload cannot carry title, body, message/Moment content,
  credentials, decryption material, authorization state, or authoritative
  navigation truth.

## 4. Canonical Model Contract

The Notification Proto adds the following logical contract. Field numbers are
owned by the implementation diff and validated by Model generation.

```text
PushChannel {
  APNS
  FCM
  UNIFIED_PUSH
}

PushEnvironment {
  DEVELOPMENT
  PRODUCTION
}

ActorDeviceRef {
  actor_ptid
  device_id
}

ApnsPushBinding {
  token
  topic
}

FcmPushBinding {
  token
}

UnifiedPushBinding {
  endpoint
  p256dh_key
  auth_secret
}

PushRegistration {
  registration_id
  actor_device
  channel
  environment
  app_install_epoch_sha256
  provider_binding_sha256
  created_at
  updated_at
  last_success_at
}

RegisterPushDeviceRequest {
  request_id
  device_id
  lifecycle_generation
  app_install_epoch_sha256
  environment
  oneof provider_binding {
    apns
    fcm
    unified_push
  }
}

RegisterPushDeviceResponse {
  request_id
  registration
  outcome // CREATED | ROTATED | UNCHANGED
}

UnregisterPushDeviceRequest {
  request_id
  device_id
  lifecycle_generation
  registration_id
  app_install_epoch_sha256
}

UnregisterPushDeviceResponse {
  request_id
  outcome // REMOVED | ALREADY_ABSENT
}

ListPushDevicesRequest {}

ListPushDevicesResponse {
  repeated PushRegistration registrations
}
```

Provider binding fields are write-only. `PushRegistration`, mutation responses,
readback, errors, telemetry, and logs never echo a token, endpoint, encryption
key, auth secret, ciphertext, nonce, or full credential digest. Public
`provider_binding_sha256` is a Station-scoped HMAC fingerprint, not a raw
SHA-256 value that permits an offline token dictionary attack.

`lifecycle_generation` binds the Rust operation and response to the active
session but is not Station business truth and is not persisted as registration
state.

## 5. Validation And Idempotency

Every mutation:

1. requires an authenticated PTID and authenticated device assertion;
2. requires `device_id` to equal that assertion;
3. requires a canonical ULID `request_id`;
4. requires a 32-byte app-install epoch digest;
5. requires one supported environment and exactly one provider binding;
6. rejects whitespace, malformed APNs tokens, non-HTTPS UnifiedPush endpoints,
   oversized credentials, empty topic/token/key fields, and unknown enums;
7. computes a canonical request commitment before persistence.

The Station stores mutation receipts keyed by
`(actor_ptid, device_id, request_id)`.

- Exact replay returns the same redacted response.
- Reusing a request ID with different canonical bytes returns
  `IDEMPOTENCY_CONFLICT` and performs no write.
- Registration is unique by
  `(actor_ptid, device_id, channel, environment)`.
- The same tuple and same provider fingerprint returns `UNCHANGED`.
- The same tuple and a different provider binding atomically replaces the
  encrypted credential and returns `ROTATED`.
- A provider fingerprint already active for a different actor/device tuple
  returns `PROVIDER_BINDING_CONFLICT`; it is never silently reassigned.
- Unregister is idempotent. A matching active row is removed; an absent row
  returns `ALREADY_ABSENT`.
- Unregister requires matching actor, device, registration ID, and install
  epoch digest so an old installation cannot remove a newer binding.

No optional identity, request ID, install epoch, environment, or provider
credential compatibility path is permitted.

## 6. Persistence And Credential Protection

`notification_push_registrations` stores:

- registration ID, actor PTID, device ID, channel, and environment;
- app-install epoch digest;
- Station-scoped provider fingerprint;
- encrypted provider binding bytes, nonce, and key version;
- created, updated, and last-success timestamps.

`notification_push_mutation_receipts` stores the bounded idempotency receipt,
canonical request commitment, redacted outcome, and expiry.

Provider credentials are encrypted before repository persistence with
AES-256-GCM under a Station-owned versioned key. Associated data binds:

```text
notification-push-registration/v1
actor_ptid
device_id
channel
environment
app_install_epoch_sha256
provider_binding_hmac
```

The Station key comes from the existing deployment secret boundary and is
derived with HKDF-SHA256 using a dedicated Notification context. The raw key,
provider credential, plaintext endpoint/token, and decrypted binding must not
be logged. A missing or invalid key fails registration closed and leaves push
unavailable without invalidating the authenticated session.

Readback is ordered by device ID, channel, and environment and returns only
active redacted registrations for the authenticated actor.

## 7. Native And Rust Callback Contract

The platform plugin exposes native-only callbacks to Rust:

```text
NativePushTokenCallback {
  platform
  native_sequence
  lifecycle_generation
  environment
  oneof provider_binding { apns, fcm, unified_push }
}

NativePushWakeupCallback {
  platform
  native_sequence
  lifecycle_generation
  delivery_kind // RECEIPT | TAP
  notification_id
  category
  target_hint
  emitted_at_ms
}
```

The native producer never supplies PTID, Station, session, or credentials.
Rust supplies the current lifecycle generation when arming the plugin and
retains the last accepted sequence per callback stream.

Rust behavior:

- discard callbacks from an unarmed plugin, stale generation, duplicate or
  decreasing sequence, unsupported provider, expired deadline, inactive
  session, Station mismatch, actor mismatch, or device mismatch;
- derive the app-install epoch digest from native secure storage and never
  expose the epoch or provider credential to Web;
- register or unregister only through the typed authenticated Rust transport;
- retain a failed current-scope registration for bounded retry, but erase it on
  logout, actor switch, Station replacement, install-epoch change, permission
  revocation, or provider rotation;
- immediately fence local callbacks during teardown, then attempt bounded
  best-effort unregister without delaying unrelated teardown indefinitely;
- emit to Web only a redacted reconcile intent containing kind,
  notification/category identifiers, target hint, generation, and sequence.

The Web runtime treats receipt and tap identically until reconcile completes:
mark Notification and affected domain projections stale, run bounded
authoritative reconciliation, then permit navigation only if the reconciled
target exists and remains authorized.

## 8. Push Payload

The provider payload is a bounded wakeup envelope:

```text
{
  "v": 1,
  "kind": "notification_wakeup",
  "notification_id": "...",
  "category": 2,
  "target_hint": "conversation|moment|profile|none",
  "issued_at_ms": 0,
  "expires_at_ms": 0
}
```

Maximum encoded payload is 1024 bytes. Unknown version/kind, missing
notification ID, invalid category/hint, expired payload, or excess size is
discarded and recorded only as redacted diagnostics. The payload is not
authority and cannot be rendered as private notification content.

## 9. Failure And Cleanup Semantics

| Condition | Required result |
| --- | --- |
| Missing authenticated PTID/device | `401`; no write |
| Body device differs from authenticated device | `403`; no write |
| Malformed provider binding or request | `400`; no write |
| Request ID reused with different bytes | typed `409`; no write |
| Provider fingerprint belongs to another tuple | typed `409`; no write |
| Credential protection key unavailable | `503`; no plaintext persistence |
| Exact registration replay | same redacted response |
| Token rotation for the same tuple | atomic `ROTATED`; old ciphertext deleted |
| Provider reports invalid/unregistered token | atomically deactivate/delete registration; no retry |
| Provider throttles or fails transiently | bounded backoff; registration retained |
| Permission revoked | local callbacks fenced immediately; bounded unregister |
| Logout/actor/Station switch | local fencing first; bounded unregister; no teardown stall |
| Stale/duplicate native callback | discard; no Web event or Station mutation |
| Push receipt | mark projection stale and reconcile |
| Push tap | reconcile, authorize, then navigate |
| Reconcile fails | remain stale/unavailable; never navigate from hint alone |

## 10. Alternatives Rejected

- Keep the old `actor_id` push schema.
- Let request bodies choose PTID or trust `device_id` without an authenticated
  device assertion.
- Return provider tokens/endpoints in device-list readback.
- Store provider credentials in plaintext, Web storage, or Mobile projections.
- Use optional request IDs, optional install epochs, or dual old/new routes.
- Treat provider token equality as authorization to transfer a registration.
- Put preview title/body or private content in provider payload.
- Let native Swift/Kotlin call Station directly.
- Let push/tap mutate read state, command state, cursor state, or navigation
  before reconcile.
- Treat Acceptance-only synthetic emitters as production implementation.

## 11. Architecture Acceptance

Accepted on 2026-09-19 after checklist review under the already authorized
continuous W7 execution:

- PTID-only identity and authenticated device equality are explicit;
- request, response, readback, storage, idempotency, rotation, conflict,
  cleanup, and failure semantics are complete;
- provider credentials remain native/Rust and encrypted Station data;
- native callbacks are generation- and sequence-fenced;
- push remains a bounded reconcile hint, never business truth;
- physical provider delivery remains optional diagnostic scope under MS-D26.
