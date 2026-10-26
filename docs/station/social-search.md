# Station Public Social Search

This is the server adapter handoff and operations note. The governing contract
is [Search design, section 6.2](../architecture/domains/search/design.md#62-station-派生索引)
and `model/domain/search/search.proto`. It is not a second Search architecture.

## Wire Contract

- Source: `station.social.public`.
- Read binding: `social.station.public.read`.
- Resolver: `social.station.public.open`.
- Authenticated `POST /api/v1/social/search/query`: generated `QueryIntent`
  to `SourcePage`.
- Authenticated `POST /api/v1/social/search/hydrate`: generated
  `HydrationRequest` to `HydrationReply`.
- Authenticated `POST /api/v1/social/search/resolve`: generated
  `ResolveRequest` to `ResolvedResource`. `source_id` must name this source.
- Success bodies use the existing typed handler serializers:
  `application/protobuf` or protojson `application/json`, selected by the
  existing Content-Type negotiation. No handwritten parallel DTO is used.
- Owner errors use the existing generated `model.ErrorResponse` protobuf
  envelope. `details.search_code` contains the generated Search error enum
  name. Authentication uses the existing structured JWT failure projector.
- Search responses, including errors, have `Cache-Control: no-store`.
  Ordinary strict-decoder errors remain owned by the transport framework.
- The existing `GET /api/v1/social/users/search` People route is unchanged.

Query kinds are intersected with public Social post/comment kinds. Empty kinds
select both. Empty scopes select Station; a nonempty scope set must include
Station. Federation, suggestions, conversation filters and attachment-only
filters are not admitted by this source. Unknown enum values are rejected.
Limits default to 20 and cannot exceed 100.

## Original Read Owner

`application/PublicReadPort` serves public post detail, profile, comment
detail/list, and Search batch reads. It loads original public rows and parent
posts, batches author metadata, bidirectional actor blocks, relevant follow
edges and Station moderation by domain AND peer ID, then delegates decisions
to the existing `domain.CanRead` and `domain.InteractionVisibility`.

An unreadable parent suppresses every comment. A commenter must also pass
block and Station moderation checks, including when the viewer is the post
author. Missing author records or body-decode failures fail closed. Private
Secure Content rows, private envelopes, grants and tokens are never Search
inputs. Batch policy and author hydration do not issue per-resource queries.

The original public tables retain the only plaintext:
`social_public_posts.text_body` and public-class `social_comments.text_body`.
Search creates no text mirror, background worker or independent authority store.

## Authority And Anchors

Authority is `social:public:<persisted original author's HomeStationDomain>`.
It is never derived from request Host, proxy headers, a tunnel, or the serving
mirror's address. Missing original Station metadata makes the resource
ineligible for Search rather than inventing an authority.

A post example:

```json
{
  "kind": "social-post",
  "id": "1001",
  "authority_namespace": "social:public:original.example"
}
```

A comment has an independent original comment ID, its typed post parent, and
an anchor whose ID is the comment ID:

```json
{
  "kind": "social-comment",
  "id": "2001",
  "authority_namespace": "social:public:original.example",
  "parent": {
    "kind": "social-post",
    "id": "1001",
    "authority_namespace": "social:public:original.example"
  },
  "anchor": {"kind": "comment", "id": "2001"}
}
```

Content revisions hash the original generated post/comment projection.
Hydration validators hash the generated result projection without its read
validity. A validator validates content only: even an unchanged response first
performs current owner authorization. Wrong authority/parent, private IDs,
deleted or denied resources yield payload-free unavailable outcomes.
Resolve always returns a freshly authorized original reference and the
allowlisted resolver binding, never an endpoint or grant. Clients own checking
that references were issued by the trusted source in their current session.

## Bounded Query And Migration

Each read has a five-second application deadline, propagated to database
queries. PostgreSQL statements have a 4.5-second timeout. Query inspects at most
100 ordered metadata positions plus one metadata lookahead. Literal matching
uses bound SQL parameters, escaping `%`, `_` and `!`, only against those IDs.
PostgreSQL matching is case-sensitive. Ordering is descending creation time,
original ID and kind.

Filtering never rewinds pagination: the next cursor advances after the last
inspected position, including unmatched and denied positions. An unfinished
scan returns `PARTIAL`, even if the candidate page is empty. Exhaustion of the
declared readable scope returns `READY`. Cursors use process-local AES-GCM:
positions and query/actor bindings are authenticated and concealed, expiry is
five minutes, and every continuation preserves the initial expiry.
Restarts invalidate old cursors.

`infrastructure/MigratePublicSearchSchema`, called from the original Social
initialization path, installs `pg_trgm` and four original-table indexes:

- `idx_social_public_search_trgm`: GIN on original post text, PUBLIC/live only.
- `idx_social_comment_search_trgm`: GIN on original comment text, public/live only.
- `idx_social_public_search_scan`: PUBLIC/live creation-time and ID keyset.
- `idx_social_comment_search_scan`: public/live creation-time and ID keyset.

Migration has a 30-second total budget, two-second lock timeout and 25-second
statement timeout. It fails rather than silently extending the budget.
The logical scan bound does not prove a physical IO bound or that the planner
chooses GIN for an ID-restricted query. Short CJK, large-corpus plans and
migration lock cost require PostgreSQL measurements before a performance claim.

## Observed Read State

Production Search requires PostgreSQL. Each query/hydration/resolve executes
inside one read-only REPEATABLE READ transaction. `pg_current_snapshot()` is
read within that transaction; all governing rows, policy and author metadata
are observed through that same handle.

`source_revision` and `policy_revision` are tagged `pg-snapshot:<SHA-256>`.
They identify a real database visibility observation, NOT a persisted mutation
watermark, monotonic generation, or remote publication linearization point.
Continuation rejects a changed observation with `SOURCE_CHANGED`; unrelated
database transactions may conservatively invalidate a cursor too.

No enforceable public read lease exists here. Every cache metadata object has
`no_store=true`, freshness and lease deadlines zero, and
`owner_check_required=true`, with an actor-bound read scope. Hydrate and resolve
recheck the original owner. The client must carry `CacheMetadata.no_store` into
its generated `SourceReadState.no_store` projection and renderer behavior.
The public read scope is `station.social.public:actor:<digest>`, where `digest`
is lowercase hexadecimal SHA-256 of the Actor PTID's exact UTF-8 bytes.
Desktop, Mobile and Station use the same bytes without multipart separators;
cursor and observation hashes retain their independent encoding.
Neither a successful HTTP response nor a local client lock linearizes a
concurrent Station mutation. SQLite fixtures never masquerade as a production
revision provider.

## Existing Native Open Routes

Post detail remains `GET /api/v1/social/moments/:post_id`. Independent comment
detail remains `GET /api/v1/social/moments/:post_id/comments/:comment_id`.
Neither requires walking the newest timeline or first comment page.

The original typed comments-list route additionally accepts generated
`ListMomentCommentsRequest.anchor_comment_id`. Anchor and cursor are mutually
exclusive. For public posts it seeks directly to the target's original
creation-time/ID position, includes the target first, then older comments in
the existing descending order. The scan is bounded at 100 plus lookahead and
uses the shared current policy owner; hidden, deleted, absent and cross-parent
anchors return not found. Response remains generated
`ListMomentCommentsResponse`. Private-list anchors are explicitly unsupported
by this public server change, not silently ignored.

## Verification Scope

Focused source checks live under the original Social owner:

- `application/public_read_test.go`: point/batch policy parity, reverse blocks,
  domain/peer moderation, bounded policy query count, old anchors and filtered
  continuation.
- `application/public_search_test.go`: canonical references, no-store,
  validator reauthorization, cursor binding/tampering/expiry/observation changes,
  unsupported filters and private-reference denial.
- `infrastructure/public_search_test.go`: literal wildcard/CJK/mixed matching,
  public-only metadata scans, continuation and index predicates.
- `infrastructure/public_search_postgres_test.go`: opt-in original-table index
  and corpus checks on temporary tables. Requires
  `SOCIAL_SEARCH_TEST_POSTGRES_DSN` naming an isolated fixture with existing
  `pg_trgm`; otherwise SKIP. It never provisions a Station or installs a shared
  extension in a test.
- `search_handler_test.go`: registered authenticated POST routes, protobuf
  error media, no-store on errors, and generated original anchor response.

SQLite and HTTP fixture checks prove the local mechanisms, not PostgreSQL
query plans, concurrent writer publication semantics, deployed migration,
native Desktop/Mobile open journeys or formal product Acceptance. Those remain
UNPROVEN until the owning controlled runtime checks run. This server slice does
not provision/deploy runtimes or change generated models/client adapters.
