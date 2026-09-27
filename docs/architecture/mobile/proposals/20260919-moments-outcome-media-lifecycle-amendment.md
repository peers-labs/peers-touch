# MS-D25 Moments Outcome And Media Lifecycle Closure

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Mobile Architecture Team
> **Module**: `model/domain/social/`, `apps/station/app/subserver/social/`, `apps/mobile/`

---

## 1. Scope

MS-D25 integrates the already accepted MS-D21 policy projection and MS-D23B
native picker boundaries into one executable Moments closure:

- Social-authored feed and detail outcomes;
- Rust-owned native media staging, encryption, upload, and cleanup;
- Mobile rendering and draft behavior over generated outcomes and opaque media
  handles.

It does not change Social or Secure Content authority, add a Web file path,
make native callbacks business truth, or claim physical-device proof.

## 2. Typed Outcome Contract

Social is the only owner of Moments visibility classification.

- Feed readback distinguishes `items`, `empty`, `filtered_empty`, and
  `unavailable`.
- Detail readback distinguishes `found`, `hidden`, `deleted`, and
  `unavailable`.
- Hidden and filtered outcomes expose only bounded explanation aggregates.
  They never expose hidden object identity, author identity, content, or block
  direction.
- Mobile consumes generated Proto outcomes and does not infer policy from
  relationship cache, HTTP status, or an empty item list.

## 3. Native Media Lifecycle

Moment media follows one Rust-owned lifecycle:

1. Mobile requests the native picker with request ID, `moment_media` surface,
   lifecycle generation, deadline, accepted kinds, count, and aggregate size.
2. Native returns exactly one bounded terminal result and temporary private
   paths only to Rust.
3. Rust validates request identity, generation, deadline, count, size, regular
   file status, and digest before moving bytes into scoped app-owned staging.
4. Rust prepares encryption and upload through the existing Secure Content and
   OSS owners, then returns canonical object descriptors.
5. Web receives opaque staging handles and sanitized metadata only.
6. Publish success, draft discard, cancellation, timeout, stale/duplicate
   callback, scope teardown, and failure each delete or retain bytes according
   to one explicit terminal outcome.

Browser `File`, native filesystem paths, content URIs, bookmarks, and durable
OS grants are forbidden business inputs.

## 4. Failure And Recovery Semantics

| Condition | Required outcome |
| --- | --- |
| True empty feed | `empty` |
| Rows removed by policy | `filtered_empty` with bounded explanation |
| Detail hidden by policy | `hidden` with no hidden payload |
| Deleted object | `deleted` |
| Owner/readback unavailable | `unavailable`, never empty |
| Picker cancelled or permission required | typed terminal result; no upload |
| Late, duplicate, expired, or stale-generation picker callback | discard and cleanup |
| Byte count, size, type, or digest mismatch | fail closed and delete partial staging |
| Publish succeeds | promote canonical descriptors and remove staging |
| Draft discarded or scope torn down | remove scoped staging |

## 5. Rejected Alternatives

- Deriving hidden/deleted/unavailable state in Mobile.
- Treating every empty response as a true empty feed.
- Restoring browser `File` upload for native Mobile.
- Passing raw native paths or grants through Web.
- Uploading plaintext directly from a native callback.
- Adding a second media store, retry owner, or compatibility path.

## 6. Owner Approval

Accepted by the Owner on 2026-09-19 with the instruction:

`APPROVE MS-D25 AND CONTINUE`.

Source closure remains W6B. Physical picker, permission, interruption,
multi-actor, and receiver-perspective proof remains W6B-PROOF/W7-PROOF and may
not be promoted from source or simulator evidence.
