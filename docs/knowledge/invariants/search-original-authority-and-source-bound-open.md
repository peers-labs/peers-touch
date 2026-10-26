---
kind: invariant
title: Search preserves original read authority and open bindings
status: active
owns:
  - packages/search-core/
  - apps/desktop/src-tauri/src/application/search/
  - apps/desktop/src-tauri/src/application/station_runtime/client.rs
  - apps/desktop/src-tauri/src/application/station_runtime/mod.rs
  - apps/desktop/src-tauri/src/application/station_runtime/route_refresh.rs
  - apps/desktop/src-tauri/src/infrastructure/station_discovery.rs
  - apps/desktop/src-tauri/src/interface/tauri_commands/search.rs
  - apps/desktop/src-tauri/src/secure_content/search.rs
  - apps/desktop/src-tauri/src/secure_content/search_policy.rs
  - apps/desktop/src-tauri/src/social/private_comment.rs
  - apps/desktop/src-tauri/src/social/search_projection.rs
  - apps/desktop/src/runtimes/searchRuntime.ts
  - apps/desktop/src/runtimes/searchQueries.ts
  - apps/desktop/src/runtimes/searchInvalidations.ts
  - apps/desktop/src/runtimes/searchOpeners.ts
  - apps/desktop/src/runtimes/momentsRuntime.ts
  - apps/desktop/src/store/moments.ts
  - apps/desktop/src/store/momentsNavigation.ts
  - apps/desktop/src/store/privateComments.ts
  - apps/desktop/src/store/search.ts
  - apps/desktop/src/services/search.ts
  - apps/desktop/src/components/search/SearchOverlay.tsx
  - apps/desktop/src/test/moments-store.test.ts
  - apps/desktop/src/services/socialOpenResource.ts
  - apps/mobile/src-tauri/src/runtime/search.rs
  - apps/mobile/src-tauri/src/runtime/search/
  - apps/mobile/src-tauri/src/commands/search.rs
  - apps/mobile/src-tauri/src/secure_content/store/search.rs
  - apps/mobile/src/runtimes/searchRuntime.ts
  - apps/mobile/src/runtimes/searchRuntime.test.ts
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
  - packages/locales/en/search.json
  - packages/locales/zh-CN/search.json
  - tooling/acceptance/search_capture.py
  - tooling/acceptance/gates/chat/device_search_capture_checks.py
  - tooling/acceptance/gates/chat/device_search_runner.py
  - tooling/acceptance/gates/chat/mobile_device_search.py
  - tooling/acceptance/gates/social/content_search_contract.py
  - tooling/acceptance/gates/social/content_search_desktop.py
  - tooling/acceptance/gates/social/content_search_mobile.py
referenced-by: []
related:
  - ../../architecture/domains/search/design.md
  - ../../station/social-search.md
  - ../../architecture/domains/social/core/product-state-model.md
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
Reusable query frames MUST retain their original issuance association, following
Search data-model §7. Independent session capacity eviction cannot leave a
successful cache hit whose references have no current issuance. Reacquire a
missing first-page association once inside the unchanged budget; an evicted
continuation fails as expired even when its old payload remains cached.
Public Social MUST emit one-based ordinal ranks for its authorized temporal
page. Shared RRF owns the continuation offset; constant first-place ranks
discard source ordering and cannot be repaired by the client.
Final native IPC MUST use the coordinator-qualified actual response vector;
Open retains only its successfully qualified issuing source. Global identity,
Station scope, request completion and consumed original-owner revision checks
remain mandatory. Re-admitting unused bindings introduces unrelated vetoes.
Full state-inventory requests intentionally check the complete composition.
Query admission must narrow declared kinds and suggestion capability before
checking original revisions of participating sources. An excluded source's
admission-time revision cannot veto a healthy single-source query; global
identity and composition integrity still apply.
Public read adapters MUST link the shared operation check and original absolute
deadline to the existing request cancellation token through admission, body
consumption and SafeRead replay. Scoped watchers stop and join on every exit;
one subscriber leaving cannot cancel a read still used by another subscriber.
Pre-submission Station discovery and route renewal consume that same original
deadline and cancellation at their existing owner. A separate discovery timeout
cannot extend the bounded Search operation.
An unresolved Comment point-read absence without an acquired projection MUST
remain an operation observation. UnknownOutcome may retry the exact command;
CommittedPendingReadback remains pending. Neither may create irreversible
resource denial. Acquired-resource absence and explicit authority failure retain
the original purge and denial contract in Secure Content operations §2.1.
Original-owner invalidations hide the affected source immediately; they do
not expose stale content while another source completes.
Current query and continuation cancellation must follow the response's actual
source vector. An unrelated notification may evict that source's cached frames,
but must not cancel a qualified current query, clear its cursor or reread a
healthy source. The displayed query, mode and filter must match current intent
before using that vector; unknown or changed intent remains conservative.
Mobile retains displayed mode so a prior suggestion cannot qualify a new submit.
No-store reconciliation MUST retain the addressed display ordinal without
replaying an advancing input cursor or reusing plaintext. Fresh reconstruction
uses only newly issued continuations, publishes no intermediate page, and
shares one unchanged five-second deadline across its at-most-32-page traversal.
Periodic no-store reconciliation enters that budgeted owner before its first
read-state await. An outer inventory read cannot delay admission indefinitely
or accumulate overlapping interval callbacks.
Only explicit Next consumes a currently unused continuation. Selected resource
identity and stable scroll must survive an unchanged page; failure cannot
silently substitute the first page. Request-owned timers must not be cleared
or allowed to mutate a newer request by a superseded finalizer.
Failed no-store reacquisition hides the response while retaining traversal,
selection and scroll metadata, following Search design §4.1. It is not a
completed empty-page observation; an authorized reply that actually loses the
selected key must still disengage selection rather than select a replacement.
Temporary source concealment MUST preserve that same metadata, following
Search data-model §7 and Desktop Search continuity. The rendered index is
derived from the single stored row key; neither concealment nor DOM viewport
clamping may replace the last qualified traversal or erase selection.
Desktop Search continuity owns selection-driven scrolling: only an explicit
arrow-key action scrolls to a row. Restoration or a changed derived index
cannot override the retained viewport.
Continuation publication MUST release its issuance metadata guard before
leaving the original authority guard, as defined by Search design §4.1.
A successful reply must not lead to an immediate Open observing a locked
issuance and incorrectly treating its valid reference as unavailable.
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
Original comment projection owners retain the selected historical anchor for
periodic and event reconciliation until navigation or scope teardown releases
it. Equivalent in-flight reads share completion; a different refresh, cursor
or anchor must complete its own read or supersede with fenced publication.
Loading alone cannot make a distinct original-target read resolve successfully.
Return proof MUST activate the original domain's actual Back control. A Social
thread header cannot be located through an unrelated common page header.
Desktop Search Return proof activates its actual return bar, not global Search
reopen. Retain and compare the pre-Open selection and viewport context; a
periodic baseline obtained only after return cannot prove that restoration.
Native Search capture MUST wait for a stable terminal rendering inside its
existing bounded capture deadline. A stable pending frame during original-owner
revalidation is not terminal evidence. Diagnostics may record that frame, but
all product terminal, readability and retained-context assertions remain required.
The Social capture includes the original thread's loading state, parent,
source, body and comment anchor in the before/after rendering comparison.
An original comment frame must show its exact text, focused anchor and viewport
visibility; a preceding DOM assertion cannot authorize a later loading screenshot.
The native capture must observe original-thread DOM mutations throughout
sampling, including queued mutation records. Two equal terminal snapshots can
surround an intermediate loading frame; a mutation revision must invalidate
that attempt. A capture-owned observer is always disconnected in finalization,
and terminal capture waits for the WebView's paint frames before sampling.
Messaging and Social MUST share that capture-owned paint wait and mutation
revision. Every retry waits for its own real paint frames inside the same
30-second deadline. Settings and concealed results require the same sampling
qualification as original Social targets; correct terminal DOM does not prove
that the compositor has discarded the preceding private-result frame.
The shared scripts live only in the Search business utility
`tooling/acceptance/search_capture.py`. Native runners and source replays consume
that owner directly, never a Gate re-export; Search selectors and capture
predicates must not enter domain-neutral Acceptance Core.
Original-target qualification MUST inspect ancestor opacity, clipping and
painted occlusion throughout the same capture. Hit testing alone misses opaque
`pointer-events:none` covers. Controlled negative replays do not replace review
of the immutable native pixels and matching DOM.
Generated before/after paint must be checked independently of the host's
pointer-events, ancestry and box size. A fixed pseudo on a zero-sized host can
cover the viewport; unresolved potentially front paint fails qualification.
Transparent or proven-behind decoration must remain admitted.
CSSOM outline width alone does not establish paint: the style must draw an
outline and its color must be visible. Qualify the actual edge bands including
outline offset; a transparent outlined host does not cover its interior.
Unresolved outline geometry remains unqualified. Ordinary fragments and
generated paint must share this rule.
Cleanup completion requires every mandatory release flag, no cleanup errors,
and a successful resources-released assertion. Preserve an existing Journey
failure while recording cleanup diagnostics; never publish cleanup-complete
or native PASS for failed release.
Account-cursor isolation probes retain exactly the issuing query selectors.
A same-account continuation must succeed first; use a separate unconsumed
cursor after account handoff. A kind/scope/locale/limit mismatch cannot prove
account isolation by producing the same cursor-expired code.

Coverage copy MUST come from the original source's generated `SourceCoverage`.
Public Station scope must never fall back to acquired-device coverage;
unfinished public scans must retain their incomplete state.
Private `INDEXING` coverage MUST retain both the acquired-device scope and
unfinished index status. Already indexed readable results can coexist with
pending original projections; hiding the scope or forcing `READY` would
misrepresent that source. Use the shared locale pack on both clients.
Every coordinator-produced source failure detail key MUST resolve in both
shared locale packs, including unavailable, timeout and invalid-response states.
Original projection readback/replay MUST NOT invalidate an unchanged Search
reference by advancing the derived index watermark. Search design §4.1 owns
the idempotent update boundary; original denial and generation checks remain
before the unchanged-projection check.
Content-key generation MUST NOT substitute for the original projection content
revision; distinct readable projection bytes must have distinct validators.
Search policy fixtures MUST NOT expect revoked private grants to recover through
unblock or Station restart. Use independent readable resources for recovery,
deletion and block proof, following the original Social relationship contract
in `product-state-model.md` §5. Keep every required UI and denial assertion.
Block also deletes the original friendship projection. A bilateral Suite may
reestablish fixture continuity only through a new original request and acceptance
on both clients after its block proof. Match the new request ID, never an old
accepted event. Previously revoked private references must remain denied after
that new relationship; unblock alone cannot authorize the next FRIENDS publish.
Fixture mutations MUST wait for the original target domain's projection to
be current, as required by Mobile lifecycle reconciliation. Global write
admission alone does not clear `moments` or `social` staleness. Observe the
original projection inside the existing bounded wait, then invoke once;
do not retry mutations or reopen admission from the Gate.
Private recovery-key preparation is a per-client Suite fixture operation.
Prepare each receiver before scenarios begin; attach-only iOS/Android legs
reuse that preparation. Recreating a random recovery phrase at the same epoch
inside each leg violates the original Store's epoch-conflict contract.
Native reference diagnostics perform a fresh original-owner read and may be
partial even after the UI showed a target. Before policy invalidation, the Gate
must acquire every required reference from one response inside its existing
bounded wait. Do not merge references from different responses, invent missing
references or force source coverage to READY. Missing issuance must produce a
canonical Gate failure rather than an uncaught object lookup.
Native denial requests must carry the source ID from that same issued result.
Dropping it makes an unknown-source denial substitute for namespace, stale
content or original-owner policy proof. Keep each expected typed denial.
Account-isolation private fixtures must acquire their SELF post through the
original read owner before Search, following Search design §6.1. Publication
completion is not a ContentReady read projection. A missing or unreadable
acquisition must fail before the UI query; it must not force index readiness.

## Why this matters

Content identity and read authorization change independently. Reusing an
unchanged validator after audience revocation would leak private content.
Reusing an arbitrary resolver would turn a trusted result into an unrelated
navigation or cross-account read. Keeping authorization and anchors at the
original owner makes the same rules apply to ordinary point reads and Search.

## Executor boundary

Source independence covers the complete query → authorized hydration pipeline,
not just candidate lookup. Search design §4.1 requires a bounded absolute
receiver deadline and the existing 100ms publication reserve inside the original
five-second budget. A slow source cannot consume another source's hydration
time. Failed windows and continuations must not survive as resumable candidates.
Successful RRF ordering, winner identity and pagination stay deterministic.
Hydration may read each bounded unissued window before fusion, but session
storage remains metadata-only and only displayed references are issued.
Bounded hydration publication follows Search design §4.1's batch boundary.
Do not reintroduce an original authentication/Store guard per resource or hold
that guard across subscription waits, encoding, decoding or original reads.
LocalSnapshot per-resource operation fences and current consumption authority
remain required. RemoteOwner hydration MUST share only a complete identical
ordered reference window, including content revisions and refresh mode, as
one live operation. Overlapping different windows MUST NOT share individual
resource flights: that splices independent original-owner observations.
Completed no-store batches MUST NOT supply later callers or partial rereads.
One subscriber cancelling MUST NOT cancel another subscriber's whole batch.
Mixed observations supplied within one original reply still fail closed.

Resolution validates resource shape, declared kind and namespace before issued
association lookup. A forged or undeclared namespace must be a protocol error;
an otherwise valid unissued reference remains unavailable. Neither case invokes
the original resolve owner or discovers another source to grant access.

The host executor MUST NOT poll original-owner synchronous reads inside a
Tokio asynchronous context. Follow Search design §4.1: use the existing
`futures-lite` executor on the host's blocking worker. Entering Tokio while
reading Station's response invokes `blocking_recv` from an asynchronous task
and panics; the outer IPC join can then report only `search cancelled`.

Mobile private index backfill MUST release its SQLCipher connection lock before
the external lifecycle check, following Search design §4.1's publication lock
order. The batch's pre-check, transactional generation check and post-check
remain required. Taking OS admission while holding the Store lock reverses the
Search publication order and can deadlock the native UI during reconciliation.

## How to verify

- Desktop `secure_content::search` tests cover current policy, revoked parent,
  late publication, cancellation, SQLCipher rollback and historical anchors.
  `private_social_search_duplicate_projection_preserves_read_revision` covers
  repeated original commits, real content changes and denied-parent replay.
- Mobile `secure_content::store::search` tests cover the same policy and
  original identity constraints.
- Mobile `searchRuntime.test.ts` delays original resolution across source
  invalidation: affected rows disappear immediately while the original Open
  and original-owner denial remain authoritative. New user intent and identity
  fencing must still cancel and suppress the old completion.
- Desktop `moments-store.test.ts` and Mobile `searchRuntime.test.ts` rebuild
  the addressed no-store page using fresh continuations. Require no intermediate
  publication, unchanged context, explicit shortened-page failure, at most
  32 pages and one five-second deadline, including unresolved native replies.
  Superseded request timers and late replies must not change a newer request.
  A current no-store Return failure followed by unchanged healthy reacquisition
  must restore the selected ResourceKey and scroll; a superseded failure cannot
  overwrite the newer frame. A genuinely missing selected key stays disengaged.
  Desktop source-concealment regressions must retain the addressed page's
  traversal and selected key, reject clamped DOM scroll writes, restore the
  unchanged final page, and honor a new selection among remaining readable
  rows. Final missing-key and new-intent replies must still reset as specified.
  Native public/private post and comment Return must compare the exact
  pre-Open viewport as well as selection after concealment and reacquisition;
  keyboard row navigation must still bring the chosen row into view.
- Desktop `privateComments.test.ts`, `moments-store.test.ts` and
  `momentsRuntime.test.ts` retain the active historical comment through periodic
  and event refreshes, release it on navigation and fence late reads. Equivalent
  readers share actual completion; a distinct public anchor executes while
  pagination is pending rather than resolving from the loading flag.
- `backfill_releases_store_before_external_lifecycle_checks` requires both
  bounded backfill phases to permit Store acquisition from each external check.
  Native Social Search must still conceal and resume all four original targets.
- Search Core `current_issuance_survives_older_sessions_of_the_same_resource`
  covers overlapping sessions, rejection before a current issuance, and fresh
  owner denial after a valid issuance.
- Desktop final IPC regressions and Mobile `commands::search::tests::native_`
  require healthy single-source queries/Open to survive unrelated owner changes,
  while consumed revisions, identity and request cancellation still reject.
- Desktop `bounded_proto_read_*` regressions require cancellation through queued
  admission, SafeRead replay and body reads inside the absolute deadline,
  surviving one subscriber's departure and releasing the watcher on completion.
- Desktop `unresolved_comment_404_readback_preserves_exact_retry_and_acquisition`
  checks exact retry bytes, pending known commit, unchanged Search revision and
  successful later acquisition. `comment_authority_failure_still_purges_and_permanently_denies_acquisition`
  requires acquired 404 and explicit 403/410 to keep original irreversible denial.
- Search Core
  `cached_first_page_reacquires_issuance_after_session_capacity_eviction`
  fills independent 100-candidate sessions while retaining their cached pages,
  then requires an original-owner reread and successful Open for the first page.
  Its cached old continuation must still fail without restarting the query.
  Station `TestPublicSearchFilteredCursorProgressAndBinding` requires distinct
  ordinal ranks on its authorized result page before shared fusion.
- Search Core `bounded_hydration_publication_cost_preserves_three_source_results`
  checks bounded original authority cost at three 100-candidate sources while
  retaining no-store, complete coverage, RRF score and winner identity.
  `hydration_batch_rejects_revocation_and_cancellation_at_commit_or_consumption`
  fences both publication boundaries; mixed remote owner observations must
  fail without issuing any resource in
  `hydration_batch_rejects_mixed_remote_owner_observations`.
- Search Core
  `remote_whole_batch_sharing_preserves_overlap_cancellation_and_no_store`
  holds the original batch reads until both windows subscribe. Different
  overlapping windows must each read all resources and preserve exact order;
  identical windows must share, survive one subscriber's cancellation, then
  reauthorize on the next query and deny after original-owner revocation.
  Both local and remote modes must retain the commit/consumption fences in
  `hydration_batch_rejects_revocation_and_cancellation_at_commit_or_consumption`.
- Search Core `continuation_response_releases_issuance_guard_before_immediate_open`
  pauses the continuation publisher after authority release, then consumes
  that response and opens its newly issued reference before the publisher
  returns. The original owner must resolve that exact resource.
- Search Core `slow_source_timeout_preserves_fast_source_within_total_budget`
  must include nonzero fast-source hydration latency. The fast source retains
  its authorized page when the slow query exhausts the unchanged budget.
  `slow_hydration_does_not_block_another_sources_authorized_page` covers the
  same outcome when candidate lookup succeeds but hydration is slow.
- Search Core `malformed_or_outside_descriptor_resolution_is_protocol_before_issuance`
  covers forged namespaces, prefix lookalikes, undeclared kinds and malformed
  references before and after issuance, plus unavailable valid unissued refs.
  `fused_pages_preserve_unissued_candidates_and_resolve_only_issuing_source`
  must retain the original RRF scores and winning source through all pages.
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
- Mobile Social return must use the Back button within the original
  `social-moment-thread`, then assert the retained Search query and filter.
- Mobile capture must wait through a stable pending frame followed by `ready`,
  fail within its deadline when pending never ends, and retain every terminal
  assertion. Diagnostic pending frames must remain unasserted.
- Social capture must also wait through original-detail/comment revalidation
  and pending anchor focus inside that same deadline. Its captured rendering
  must bind the expected original parent/source and the visible exact comment,
  or the original post body. Inspect the native pixels before claiming Open.
- Replay a terminal/loading/terminal transition during the native screenshot:
  even when both terminal DOM samples are equal, capture must reject the first
  image, repeat within its existing deadline and release its mutation observer.
- `device_search_capture_checks.py` rejects noninteractive opaque covers,
  broken Back controls, changed pre-Open context, cleanup errors and false
  release flags. Its exact-selector account control advances a separate
  same-account cursor before testing an unconsumed handoff cursor. Native
  captures must independently satisfy those observations on the current source.
  The actual shared visibility JS and both Social consumers must reject opaque
  ancestor pseudos and fixed pseudos on zero-sized hosts, while transparent,
  hidden and proven-behind counterparts remain legal.
  Default `outline-width: 3px` with `outline-style: none`, transparent outlines
  and transparent outlined interiors must remain admitted; actual overlapping
  outline bands and unresolved offsets must fail qualification in both consumers.
- `chat-device-search-contract` executes the source-only capture race replays
  in `device_search_capture_checks.py`: both platform Settings/concealment
  paint delays, Messaging/Social mutation-and-repaint, original pending/focus,
  bounded failure, observer/context finalization and unasserted diagnostics.
  Native Settings and suspended screenshots must still be reviewed against
  their immutable current DOM; those replays do not provide native pixel proof.
- The same Journey must complete private Open after original projection
  materialization, reject unavailable targets and show distinct acquired-private
  and current-Station public coverage.
- Check `search.coverage.social_indexing` in both shared locale packs: it must
  identify acquired private posts/comments and disclose unfinished indexing.
  The existing Mobile Social coverage assertion must still run against a
  native `INDEXING` response; do not replace it with a ready-state fixture.
- Check every failure detail key emitted by Search Core `session::failed`
  against both shared packs. Native outage capture must retain Messaging results
  and reject unresolved localization keys.
- Social native Gates must prove outage recovery and parent deletion before
  blocking their independent targets, with all four targets visible before block
  and all four old references denied after it.
- Both Mobile legs must establish their next FRIENDS fixture through original
  relationship authority. After unblock, a new request must be accepted on both
  clients while every old private block reference remains unavailable.
- Native mutation preparation must wait while the original target domain is
  stale even when global write admission is open; permanent staleness must
  fail within the existing deadline without invoking the mutation.
- Mobile Social reference acquisition must retry an accepted partial response
  within the existing 30-second wait, require all targets in one response, and
  fail canonically for permanently missing targets or rejected queries.
  Disjoint partial responses must never be merged into an issuance snapshot.
- Pause a real Messaging continuation, deliver an unrelated Social notification,
  then complete the page. Both clients must retain the current request and cursor
  and publish the final page without another source read. A relevant notification,
  changed intent and identity fence must still cancel or conceal as specified.
- Mobile Messaging forged, edited and retracted reference checks must preserve
  each original result's `sourceId`; a missing source must not satisfy that proof.
- Desktop and Mobile account fixtures must qualify the exact SELF post as
  CONTENT_READY through the original read, then prove Search visibility and
  old-account result/reference denial. Publication alone cannot seed this proof.
- Inspect Desktop/Mobile `SearchExecutor::block_on`: it must not call
  `tauri::async_runtime::block_on`. The native Social Search Suite must show
  mixed results without `Cannot block the current thread from within a runtime`
  in either client log.

## Crosswalks

- [Public API ownership](../pitfalls/public-api-owner-must-follow-resource-domain.md)
- [Search directory ownership](../../architecture/domains/search/module-layout.md)
