---
kind: invariant
title: Search preserves original read authority and open bindings
status: active
owns:
  - packages/search-core/
  - apps/desktop/src-tauri/src/application/search/
  - apps/desktop/src-tauri/src/secure_content/search.rs
  - apps/desktop/src-tauri/src/secure_content/search_policy.rs
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
Original-owner invalidations hide the affected source immediately; they do
not expose stale content while another source completes.

## Why this matters

Content identity and read authorization change independently. Reusing an
unchanged validator after audience revocation would leak private content.
Reusing an arbitrary resolver would turn a trusted result into an unrelated
navigation or cross-account read. Keeping authorization and anchors at the
original owner makes the same rules apply to ordinary point reads and Search.

## How to verify

- Desktop `secure_content::search` tests cover current policy, revoked parent,
  late publication, cancellation, SQLCipher rollback and historical anchors.
- Mobile `secure_content::store::search` tests cover the same policy and
  original identity constraints.
- Station `TestMomentReadPolicyOriginalAuthority` covers post/comment policy
  and parent revocation; `public_search_test.go` covers validator
  reauthorization and source-bound resolution.
- Read the source adapter's generated `SourceReadState` mapping and confirm
  `no_store` survives IPC and presentation.
- Native UI proof must search, open the original post/comment, focus its exact
  anchor, return with the prior query and remove revoked content. Source tests
  alone leave that journey `UNPROVEN`.

## Crosswalks

- [Public API ownership](../pitfalls/public-api-owner-must-follow-resource-domain.md)
- [Search directory ownership](../../architecture/domains/search/module-layout.md)
