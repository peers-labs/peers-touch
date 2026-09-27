# MS-D23B Native Scheduler And Media Picker Completion Amendment

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/src-tauri/plugins/platform-permissions/`, `apps/mobile/src-tauri/src/platform/`

---

## 1. Scope

This amendment fixes the final W7 design details for:

- one app/environment scheduled-reconcile registration on Android and iOS;
- exactly-once native completion and expiration behavior;
- native media selection with one terminal result;
- Rust-owned staging and opaque Web handles.

It does not make background execution reliable or periodic on demand, grant
background business authority, define media upload/publish behavior, or prove
physical-device behavior. Physical behavior remains optional diagnostics under
MS-D26; deterministic simulator coverage belongs to W6B/W7-PROOF.

## 2. Scheduled Reconcile Contract

The only identifiers are:

```text
com.peers.touch.mobile.reconcile.v1.development
com.peers.touch.mobile.reconcile.v1.production
```

- Android registers unique periodic WorkManager work with
  `ExistingPeriodicWorkPolicy.UPDATE`, a 15-minute minimum interval, connected
  network constraint, and no business payload.
- iOS registers both permitted BGTask identifiers at launch and submits only
  the active environment with `earliestBeginDate = now + 15 minutes`.
- Re-registering the same identifier replaces or refreshes that one schedule;
  parallel schedule identities are forbidden.
- Native callback emits only source, identifier, native sequence, armed Rust
  generation, and deadline.
- Rust accepts only the current generation and increasing sequence, runs the
  existing bounded lifecycle reconciliation, and acknowledges the callback.
- Native completion is guarded by an atomic/locked terminal flag. Success,
  failure, cancellation, and expiration race through the same completion
  function; exactly one call reaches WorkManager/BGTaskScheduler.
- iOS expiration and a 25-second native deadline complete `false`. Android
  cancellation returns failure/retry according to WorkManager cancellation;
  no business command is persisted or dispatched.
- No active authenticated session is a successful no-work completion, not a
  fabricated reconciliation success.

## 3. Media Picker Contract

`NativeMediaPickRequest` requires:

- canonical ULID request ID;
- surface `chat_attachment` or `moment_media`;
- capability `photo_library`, `camera`, or `document`;
- current Rust lifecycle generation;
- deadline no more than five minutes in the future;
- accepted media kinds from `image`, `video`, or `file`;
- item count `1..10`;
- aggregate byte bound `1..67,108,864`.

One picker request may be active. A concurrent request returns
`PICKER_BUSY`. Native code returns exactly one terminal result:

- `selected`: native copies every selected item into its private cache and
  returns native-only temporary paths plus media type, MIME type, byte length,
  and SHA-256;
- `cancelled`;
- `permission_required`;
- `expired`;
- `failed` with a stable reason code and no filesystem details.

Rust verifies request ID, generation, deadline, count, aggregate size, regular
file status, declared length, and SHA-256. It then atomically copies selected
bytes into:

```text
<app-data>/native-media-staging/v1/<scope-digest>/<opaque-handle>.stage
```

The scope digest binds Station PTID and draft surface. Rust deletes every
native temporary file after copy or rejection. Web receives only opaque
handles and metadata; it never receives a native path, content URI, bookmark,
security-scoped URL, or OS grant.

Late or duplicate results are discarded by request ID and generation.
Backgrounding, timeout, scope teardown, explicit cancel, and process restart
terminate or expire outstanding requests. Draft discard and publish promotion
remain the owning Chat/Moments staging flows.

## 4. Failure Semantics

| Condition | Result |
| --- | --- |
| Duplicate scheduler registration | same identifier updated; no second schedule |
| Scheduler callback after generation change | no reconcile; complete once as no-work |
| Scheduler expiration races with Rust ack | first terminal transition wins |
| Missing session during scheduler wake | complete once; no business mutation |
| Picker already active | `PICKER_BUSY`; existing request unchanged |
| Permission unavailable | `permission_required`; no synthetic file |
| Picker dismissed | `cancelled`; no synthetic file |
| Deadline elapsed | `expired`; late native result deleted and discarded |
| Item count/size/hash mismatch | `failed`; all temporary files deleted |
| Scope changes during picker | result discarded; all temporary files deleted |
| Rust staging copy fails | `failed`; partial staged output and native temporary files deleted |

## 5. Alternatives Rejected

- Multiple work identifiers per feature or actor.
- Native background command dispatch or cursor advancement.
- Marking scheduled work complete before Rust acknowledgement.
- Web `<input type=file>` as the native product path.
- Returning filesystem paths or content URIs to Web.
- Treating picker dismissal as an empty selected result.
- Keeping temporary native files after terminal failure.
- Compatibility paths that accept missing generation, request ID, or bounds.

## 6. Architecture Acceptance

Accepted on 2026-09-19 under the already authorized continuous W7 execution.
The contract has one scheduler identity family, one completion owner, one
picker request owner, explicit bounds, exact terminal states, and no business
truth or native path leakage. W7 source checks own the deterministic terminal
state matrix; W7-PROOF owns installed simulator platform integration. Physical
timing, permission, and picker execution are optional diagnostics under
MS-D26.
