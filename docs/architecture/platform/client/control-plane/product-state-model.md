# X Config - Product State Model

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-10-17 | **Updated**: 2026-10-19
> **Owner**: Client Platform

---

## 1. Console State

| State | Meaning | Allowed actions |
|---|---|---|
| `signed_out` | No operator session | Sign in |
| `loading` | Draft/history loading | Wait or retry |
| `ready_clean` | Draft matches latest publication | Edit, restore, or republish at a higher sequence |
| `ready_dirty` | Local draft differs | Edit, save, validate |
| `validating` | Server validates complete draft | Wait |
| `validation_failed` | Findings block publication | Edit and retry |
| `ready_to_publish` | Validation and exact diff acknowledgement pass | Publish |
| `publishing` | One direct publication request is in flight | Observe |
| `published` | Signed bytes committed | Inspect history or edit |
| `publish_failed` | No successful publication commit | Retry after fixing owner |
| `source_conflict` | Repository head changed | Reload and re-review |
| `history_unavailable` | Repository publication state unreadable | Refresh |
| `unauthorized` | Subject is not allowlisted | Sign out |

There is no `awaiting_approval` state.

## 2. Draft State

```text
clean
  -> dirty
  -> validating
  -> invalid | valid
  -> diff_acknowledged
  -> publishing
  -> published | failed | conflicted

invalid -> dirty
failed -> publishing | dirty
conflicted -> dirty
published -> clean
```

## 3. Publication State

```text
draft_loaded
  -> validated
  -> acknowledged
  -> repository_cas
  -> statement_built
  -> signed
  -> atomically_committed
  -> publicly_readable

repository_cas -> conflict
statement_built -> signing_failed
signed -> persistence_failed
```

Success means metadata and exact signed envelope bytes committed together.
Public HTTPS and client-core verification are deployment closure evidence, not
additional durable publication states.

## 4. Client Snapshot State

| State | Meaning | User impact |
|---|---|---|
| `embedded` | Build fallback only | Basic suggestions may exist |
| `cached_current` | Verified cache current | Suggestions/releases available |
| `cached_stale` | Cache expired | Non-actionable stale status |
| `fetching` | Refresh in progress | Existing state remains usable |
| `rejected` | New response invalid | Last-known-good remains |
| `current` | New snapshot accepted | Projection refreshes |
| `unavailable` | No remote/cache | Local Station registry still works |

## 5. Suggestion State

```text
suggested_current
  -> discovering
  -> trust_confirmation | route_choice
  -> verified
  -> registry_committed

discovering -> unavailable | invalid
trust_confirmation -> cancelled
route_choice -> cancelled
suggested_current -> dismissed
```

Catalog removal transitions only suggestion state. It never removes a verified
Station registry entry.
