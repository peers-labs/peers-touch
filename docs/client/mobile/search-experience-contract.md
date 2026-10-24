# Mobile Search

Source: the approved Mobile Search proposal (2026-10-23), Search product and
design contracts. Android and iOS share implementation and require separate
native evidence.

Search finds acquired readable messages, private Social posts/comments and
current-Station public Social content, then returns to the original object.
Its main subject is the matched fragment.
The signature is continuity from fragment to exact original position and back.
The shell owns entry and the detail stack; Search owns a single full-height
content rail, input/filter action rail, source coverage and local recovery.
There is no floating result panel or independent data store.

Primary-page Search occupies the existing header action position. Conversation
Search opens the same detail with an explicit conversation filter. The user may
expand to all readable content. Message, post/comment, attachment-name and
function filters are explicit. Function results bind only existing Mobile
settings routes. Ask and additional content sources are outside this milestone.
Social comments show their own fragment, readable parent-post summary and the
original Social author projection; private content never implies recovered history.

The Search detail is `on-visit + none`; its headless runtime retains one query,
filter, selected result, page cursor history and scroll metadata. Native
Search owns execution and bounded content caching. Renderer retains at most one
100-item result page and 32 page cursors, without a second retrieval engine.
Each original domain owns materialization, read rights and exact anchors.
Social comments open an independently addressed historical comment inside the
original post detail. Search presentation does not load profiles or cache bodies.

Input edits publish immediately and debounce device suggestions. Submit is the
explicit boundary for Station public search. Private Social requires a current
original-owner policy read and contributes no offline body suggestions.
Pagination preserves query and scope. Object opening
pushes the owner detail; Back returns to Search with filter, selection and
position. Returning revalidates the native read scope, source revision and
expiry before revealing private rows. Background, auth transition or owner
invalidation hides rows immediately. Suspend retains presentation metadata;
account teardown clears it.

Empty query, loading, result, no match, invalid query, timeout/unavailable,
source changed, indexing and partially acquired history are distinct states.
Coverage must come from the original owner; absent recovery data cannot prove
complete history. Recovery preserves input. No raw actor ID or exception is
primary display copy.

Shared UI Identity and the trust-state pattern govern spacing, colors, controls
and state language; there is currently no dedicated Search module UI Identity.
Reuse normalized antd controls and the original bounded list. The page has one
scroll root, a stable header and controls, and clears native keyboard/system
safe areas. Touch actions have at least 44px hit areas, labeled icons, visible
focus, status semantics and no essential motion.

Positive calibration: immediate route feedback, readable fragment-first rows,
original object position and recoverable back navigation. Reject unrelated
card grids, decorative animation, hidden legacy search, fabricated recovery
success and screenshot-only completion.

Required evidence: native Android/iOS entry, scoped/global queries, Chinese
short terms, attachment names, pagination, original/thread opening, back
restoration, invalid-query recovery, Settings target, content mutation,
background/lock/auth fencing; light/dark, narrow, long content and localization,
touch/keyboard/focus, semantic roles and bounded DOM. Prototype checks describe
design only. Field performance and physical-device assistive technology remain
unproven until measured.
