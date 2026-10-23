# Desktop Search application

`runtime.rs` binds the portable read cache to authenticated native windows.
`messaging.rs` re-exports the shared Messaging `SearchContributor` adapter over
the original Store. Request admission, caller cancellation and execution live
in `packages/search-core/src/{requests,runtime}.rs`; operation lifetimes live
in the shared cache, independently from a request. Mobile binds the same owners
through its native lifecycle and original Messaging Store.

Messaging owns a selective write watermark over searchable projections and
authority tables. Inbox, key inventory and housekeeping writes do not expire
search content. SQLite hooks include full-table deletion; `data_version`
conservatively handles other connections. Authority namespaces are cached at
the original Store until conversation or external writes change them.
Cache commit and IPC publication hold both the
identity transition guard and original Store revision guard. Empty query pages
are short lived. A source change invalidates query dependencies; candidates
carry original-owner projection revisions, so unaffected resource projections
remain reusable after unrelated message writes. Resolve remains tied to the
current source snapshot.
The existing projection event path handles live changes, while read-state
reconciliation detects missing events without repeating FTS queries.

There is no locally fabricated read lease. Every publication checks the
original native owner. Cache bytes are bounded memory only; the original
SQLCipher/FTS index remains Messaging-owned. Continued pages preserve the
first page's expiry and source snapshot.

Applet and Station integration is deferred. The selected Desktop/Mobile native
proofs and remaining scope are indexed in
[Search evidence](../../../../../../docs/architecture/domains/search/acceptance-evidence.md).
