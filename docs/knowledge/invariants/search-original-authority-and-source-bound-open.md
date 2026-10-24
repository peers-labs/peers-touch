---
kind: invariant
title: Search preserves original read authority and open bindings
status: active
owns:
  - packages/search-core/
  - apps/desktop/src-tauri/src/application/search/
  - apps/desktop/src-tauri/src/secure_content/search.rs
  - apps/desktop/src-tauri/src/secure_content/search_policy.rs
  - apps/desktop/src-tauri/src/social/search_projection.rs
  - apps/desktop/src/runtimes/searchRuntime.ts
  - apps/desktop/src/runtimes/searchQueries.ts
  - apps/desktop/src/runtimes/searchInvalidations.ts
  - apps/desktop/src/runtimes/searchOpeners.ts
  - apps/desktop/src/services/socialOpenResource.ts
  - apps/mobile/src-tauri/src/runtime/search.rs
  - apps/mobile/src-tauri/src/runtime/search/
  - apps/mobile/src-tauri/src/secure_content/store/search.rs
  - apps/mobile/src/runtimes/searchRuntime.ts
  - apps/mobile/src/runtimes/searchInvalidations.ts
  - apps/mobile/src/features/search/
  - apps/mobile/src/features/social/openSearchResource.ts
  - apps/station/app/subserver/social/application/public_read.go
  - apps/station/app/subserver/social/application/public_search_service.go
  - apps/station/app/subserver/social/application/public_search_hydration.go
  - apps/station/app/subserver/social/application/public_search_projection.go
  - apps/station/app/subserver/social/application/public_search_test.go
  - apps/station/app/subserver/social/application/private_read_policy.go
  - apps/station/app/subserver/social/infrastructure/private_read_policy.go
referenced-by: []
related:
  - ../../architecture/domains/search/design.md
  - ../../station/social-search.md
detected: 2026-10-24
---

# Search preserves original read authority and open bindings

## What must hold

The original business owner MUST authorize query, hydration and resolution.
Derived indexes and unchanged content validators MUST NOT grant read rights.
Unreadable parents suppress comments. Private plaintext and derived tokens
stay inside the existing SQLCipher owner; Station public Search reads the
original public tables. Search MUST NOT create a parallel authority store,
public subserver or plaintext mirror.

Public Social and private Social have no offline read lease. Their generated
read metadata MUST retain `no_store`, zero freshness/lease deadlines, and
`owner_check_required`. A PostgreSQL snapshot describes an observation; it is
not a monotonic mutation watermark or a promise that the next read remains
authorized.

Open MUST consume a reference issued by the current source session and its
allowlisted resolver binding. Social comments retain their own canonical ID,
typed parent and exact comment anchor. A caller URL, source ID alone, first
timeline page or first comment page cannot establish target identity.
An older query session MUST NOT shadow a current valid issuance of the same
resource. Search design §4.1 owns the matching rule: all current binding,
identity, resource and expiry checks still apply, followed by original-owner
authorization. Finding only an older issuance cannot grant access.
Original-owner invalidations hide the affected source immediately; they do
not expose stale content while another source completes.
Query invalidation MUST NOT cancel an Open because its original owner is
materializing the target. Search design §4.1 separates those lifecycles:
the original current read and availability result decide Open, while identity
or user intent changes still cancel it. Query reconciliation waits until Open
settles. A non-readable private projection MUST NOT be accepted as a target.
The query owner MUST recheck Open after asynchronous read-state waits, including
failure publication. An earlier idle observation cannot authorize a late query
or error projection over a current Open.
The original target's focus must wait for the Search overlay focus boundary to
release, as defined in Search design §4.1. The overlay must declare navigation
before awaiting Open so its teardown cannot restore the old entry focus.

Coverage copy MUST come from the original source's generated `SourceCoverage`.
Public Station scope must never fall back to acquired-device coverage;
unfinished public scans must retain their incomplete state.
Original projection readback/replay MUST NOT invalidate an unchanged Search
reference by advancing the derived index watermark. Search design §4.1 owns
the idempotent update boundary; original denial and generation checks remain
before the unchanged-projection check.
Content-key generation MUST NOT substitute for the original projection content
revision; distinct readable projection bytes must have distinct validators.

## Why this matters

Content identity and read authorization change independently. Reusing an
unchanged validator after audience revocation would leak private content.
Reusing an arbitrary resolver would turn a trusted result into an unrelated
navigation or cross-account read. Keeping authorization and anchors at the
original owner makes the same rules apply to ordinary point reads and Search.

## Executor boundary

The host executor MUST NOT poll original-owner synchronous reads inside a
Tokio asynchronous context. Follow Search design §4.1: use the existing
`futures-lite` executor on the host's blocking worker. Entering Tokio while
reading Station's response invokes `blocking_recv` from an asynchronous task
and panics; the outer IPC join can then report only `search cancelled`.

## How to verify

- Desktop `secure_content::search` tests cover current policy, revoked parent,
  late publication, cancellation, SQLCipher rollback and historical anchors.
  `private_social_search_duplicate_projection_preserves_read_revision` covers
  repeated original commits, real content changes and denied-parent replay.
- Mobile `secure_content::store::search` tests cover the same policy and
  original identity constraints.
- Search Core `current_issuance_survives_older_sessions_of_the_same_resource`
  covers overlapping sessions, rejection before a current issuance, and fresh
  owner denial after a valid issuance.
- Station `TestMomentReadPolicyOriginalAuthority` covers post/comment policy
  and parent revocation; `public_search_test.go` covers validator
  reauthorization and source-bound resolution.
- Read the source adapter's generated `SourceReadState` mapping and confirm
  `no_store` survives IPC and presentation.
- `TestPublicSearchReadScopeMatchesNativeBinding` checks the native read-scope
  byte contract defined in `docs/station/social-search.md`; changing the
  multipart cursor hash must not change that actor-bound scope.
- Native UI proof must search, open the original post/comment, focus its exact
  anchor, return with the prior query and remove revoked content. Source tests
  alone leave that journey `UNPROVEN`.
- The same Journey must complete private Open after original projection
  materialization, reject unavailable targets and show distinct acquired-private
  and current-Station public coverage.
- Inspect Desktop/Mobile `SearchExecutor::block_on`: it must not call
  `tauri::async_runtime::block_on`. The native Social Search Suite must show
  mixed results without `Cannot block the current thread from within a runtime`
  in either client log.

## Crosswalks

- [Public API ownership](../pitfalls/public-api-owner-must-follow-resource-domain.md)
- [Search directory ownership](../../architecture/domains/search/module-layout.md)
