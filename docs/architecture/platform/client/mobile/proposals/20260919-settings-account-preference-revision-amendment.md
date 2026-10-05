# MS-D22A Settings Account Preference And Revision Amendment

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-19 | **Updated**: 2026-09-19
> **Owner**: Mobile Architecture Team
> **Module**: `model/domain/`, `apps/station/`, `apps/mobile/`

---

## 1. Scope

This amendment resolves the contracts that blocked W6C:

- the current-release disposition of additional cross-device account
  preferences;
- revision and conflict semantics for Actor Profile and Notification
  preference writes;
- selected-owner save and lost-response reconciliation semantics.

It does not change device-local settings, Social blocked-user authority,
Station registry ownership, push registration, or native proof scope.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
| --- | --- | --- | --- | --- |
| MS-C09 requires owner-backed account and device settings | `verified_fact` | `product-definition.md` MS-C09; `acceptance-matrix.md` MS-PA12/MS-PA21 | high | none after Option A acceptance |
| MS-D22 forbids a generic Settings store and assigning all controls to `ActorPreferences` | `accepted_decision` | `decisions.md` MS-D22 | high | none |
| Existing Profile owns six profile fields and four privacy fields | `verified_fact` | `actor.proto`; `actor/profile.go`; Mobile Profile gateway | high | revision/CAS contract |
| Notification owns category `enabled`, `push_enabled`, and `sound_enabled` | `verified_fact` | `notification.proto`; Notification subserver | high | revision/CAS contract |
| Social owns a revisioned blocked list and unblock command | `verified_fact` | `relationship.proto`; W5-SOCIAL | high | required simulator readback; physical execution optional |
| The legacy `ActorPreferences` DTO contains theme, locale, telemetry, endpoint overrides, and feature flags but has no live owner API | `verified_fact` | `model/domain/actor/preferences.proto`; repository reference scan | high | none |
| Theme and locale are device-local under MS-D22; endpoint overrides and feature flags are not accepted user account settings | `accepted_decision` / `inference` | MS-D22 owner matrix; no product field definition | high | Owner decision for any remaining account fields |
| Profile POST and Notification preference POST do not submit an observed revision | `verified_fact` | `UpdateProfileRequest`; `UpdateNotificationPreferenceRequest`; Station handlers | high | conflict protocol |
| Requiring revisions only from Mobile would either break Desktop or require a compatibility path | `verified_fact` | Desktop Profile POST callers omit revision; shared Station routes | high | cross-client cutover decision |

## 3. Resolved Blocker

The pre-amendment W6C contract required a generated account-preference owner
and revisioned Station readback, but the architecture did not define:

1. any additional account-preference field not already owned by Actor Profile,
   Notification, Social, or `deviceSettingsRuntime`;
2. whether Profile revision covers both `touch_actor` and
   `touch_actor_meta`;
3. whether Notification revision is per category or aggregate;
4. the stale-write response and canonical readback shape;
5. the cross-client cutover for Desktop callers that currently submit no
   observed revision.

The Owner accepted Option A and the CAS hard cut on 2026-09-19. Creating an
empty service, reusing `ActorPreferences`, or accepting missing revisions for
old clients remains forbidden.

## 4. Accepted Decisions

### MS-D22A.1: No Additional Account-Preference Owner In This Release

The current Mobile release has no additional cross-device account-preference
fields. Account-scoped settings are the existing Actor Profile, Notification,
and Social owners. Device settings remain device-local.

MS-C09, MS-P05, MS-PA12, MS-PA21, and W6C must not require a separate
account-preference service or expose a placeholder account-preference section.
A future product amendment must enumerate every new field, default, validation,
privacy, reset, and cross-device behavior before architecture can assign a new
owner.

`ActorPreferences.theme`, `locale`, `endpoint_overrides`, and `feature_flags`
must not be reused: they conflict with device ownership or expose
operator/developer configuration as user truth.

### MS-D22A.2: Use Owner-Specific Monotonic Revisions

- Actor Profile exposes one monotonic `profile_revision` covering the
  transactionally updated editable Profile and privacy fields across
  `touch_actor` and `touch_actor_meta`. Counter-only changes do not increment
  it.
- Notification exposes one aggregate monotonic
  `notification_preferences_revision` for the complete category-preference
  snapshot. One batch mutation compares and updates all submitted categories
  in one transaction, so partial category commits are impossible.
- Every mutating request carries the exact `observed_revision`.
- A matching write increments revision once and returns the canonical
  committed snapshot.
- A stale revision performs no write and returns a typed conflict plus the
  latest canonical snapshot.
- Empty mutations are invalid. A valid mutation whose requested values already
  equal canonical state returns `UNCHANGED` and does not increment revision.
- Mobile preserves its draft and renders conflict until reload, discard, or a
  new explicit save.

### MS-D22A.3: Make Revision Enforcement A Cross-Client Hard Cut

Profile and Notification routes must not accept both revisioned and
unrevisioned mutation semantics indefinitely.

The implementation plan must include all production clients of the shared
routes, regenerated bindings, Station persistence, and semantic reference
checks in one cutover. Mobile-only enforcement is rejected because it leaves
the Station owner with dual mutation truth.

### MS-D22A.4: Keep Social Blocked Users Independent

Settings consumes the existing Social runtime projection and command owner.
It may add selected-detail loading, unavailable, empty, retry, and mutation
presentation state, but must not create another blocked-user store or infer an
empty list when Social readback fails.

### MS-D22A.5: Save Only The Selected Owner

Each Settings detail saves only its selected canonical owner. Profile,
Notification, Social, and device-local writes have independent dirty,
saving, saved, conflict, unavailable, and failed state. Settings does not
attempt a cross-owner transaction and does not report another owner saved.

### MS-D22A.6: Exact Wire And Lost-Response Semantics

Profile and Notification use generated request/response messages.

- Applied, unchanged, and stale-revision outcomes return HTTP `200` with a
  typed outcome and the canonical latest snapshot.
- Missing/zero revision, empty mutation, duplicate Notification category, an
  unspecified category, or an invalid field returns HTTP `400` and performs no
  write.
- Missing authentication returns HTTP `401`; unavailable/internal owner
  failures return HTTP `500`.
- A client maps the typed stale outcome to visible conflict; it must not treat
  HTTP success alone as saved.
- After a write response is lost, the client reads the owner snapshot before
  retry. Exact draft equality means the write committed; a changed revision
  with divergent values means conflict; an unchanged base revision permits an
  explicit retry.
- The superseded single-category Notification mutation is deleted at the
  cross-client cutover.

## 5. Failure Semantics

| Condition | Required result |
| --- | --- |
| Account field ownership not enumerated | section unavailable; no persistence |
| Owner unavailable | disable only that section; do not retain defaults as truth |
| Profile or Notification revision stale | no write; typed conflict with canonical snapshot |
| Write response lost | reconcile owner readback before retry; do not claim saved |
| Valid mutation already equals canonical state | typed unchanged with the same revision |
| Notification batch contains any invalid or duplicate category | reject the whole batch; no write |
| Social blocked-list read fails | unavailable, not empty |
| Unblock conflicts | preserve row, show conflict, allow authoritative retry |
| Device setting write fails | preserve committed local readback and draft |

## 6. Alternatives Rejected

- Revive the legacy `ActorPreferences` DTO as the API.
- Store account preferences in Mobile local storage.
- Put blocked users or Notification fields under Actor Profile.
- Use timestamps without an explicit comparison contract.
- Make revisions optional for legacy callers.
- Sequential per-category Notification CAS writes.
- Cross-owner save orchestration.
- Report a divergent post-write readback as saved.

## 7. Owner Approval

Accepted on 2026-09-19 with the following verdict:

`ACCEPT MS-D22A A + CAS`, with the review corrections incorporated:

- no additional account-preference fields or owner;
- dedicated Profile revision;
- aggregate atomic Notification revision;
- selected-owner save state;
- cross-client source hard cut;
- exact typed outcomes and lost-response reconciliation.
