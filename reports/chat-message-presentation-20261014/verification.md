# Chat message presentation

Scope: Desktop and Mobile **prototypes** in
`peers-touch-mobile-usable`, branch `feat/mobile-infra-chat-usable`,
base HEAD `4190ab2794f20a10adaaefabbba04a5ffa30b5b3`. Changes are local and
uncommitted. Both changed previews were exercised through
`http://localhost:3210`; the Desktop site uses the same worktree as Mobile.

Direct messages and own messages omit timeline sender labels. Group messages
show the actual person once per sender cluster. Continuations preserve the
avatar track, full corners and one ordinary timestamp at cluster end.
Actor changes, system/date rows, time gaps and unresolved actor identities
break clusters.

Both prototypes use the same 24px reaction tag with 6px corners. Mobile keeps
separate 44px hit bounds; measured adjacent bounds do not overlap. Selection,
removal, keyboard activation and the add entry work. The Desktop picker uses
the actual message viewport and selected row bounds for above/below placement.
When neither side fits, it uses a scrollable inline panel outside the message
body; the long-message interaction check proves that its emoji remains
clickable without covering the text.

Replies and forward previews retain source names. Desktop preserves the
reply target when sending. Mobile search and pinned-message summaries read
message actor identity. Own reply quotes remain readable outside the bubble.
Moments comment actions retain the feed, navigation, drafts and input focus.

Verification:

- `check-message-presentation.mjs`: PASS; Direct/Group/self, continuation
  geometry, sender changes, time/system boundaries, unresolved authors,
  long names, Mobile dark/narrow layouts, reaction interactions, quote and
  forward identity, Mobile search identity, a long-message action fallback,
  and inline-comment regression.
- Negative controls: PASS; repeated private sender labels, a group title
  used as an actor, and old oversized reaction circles are rejected.
- `check-chat-parity.mjs`: PASS using current-worktree Desktop and Mobile.
  Both avatars measure 32px, tail corners 4px, composer radius 12px and
  inline retry height 15px.
- `check-layout.mjs`: PASS; 81 captures, zero defects.
- `check-product-parity.mjs`: PASS against the existing Desktop master
  reference on port 3212; Auth, Settings, Contacts, Group and Social scope
  remain aligned.
- Mobile TypeScript: PASS. Portal and Mobile builds: PASS.
- Desktop changed-source TypeScript comparison: zero new errors. Its
  existing two `CallHud.onHangup` type diagnostics remain, so a clean full
  Desktop typecheck is not claimed.
- `git diff --check`: PASS.
- Completion lifecycle audit: `implementation-ready` PASS for the current
  declaration/mount. This does not close the native Mobile task.

Visual inspection:

- [Mobile reactions, light](mobile-reactions-light.png)
- [Mobile reactions, dark](mobile-reactions-dark.png)
- [Mobile groups, narrow dark](mobile-group-dark-narrow.png)
- [Desktop reactions](desktop-reactions-light.png)
- [Desktop sender clusters](desktop-group-clusters.png)
- [Desktop private conversation](desktop-private-no-names.png)
- [Browser results](results.json)

The inspection confirms that message content dominates the reaction row,
group titles do not appear in actor slots, and continuation alignment
survives switching conversations. The shared presenter and reaction
component add no runtime subscriptions or hidden trees; Mobile retains its
existing message window and page lifetime.

Native runtime, backend delivery, native keyboard and assistive-technology
behavior remain UNPROVEN. This is not a FWA certification. The other open
craft findings in the Mobile prototype README remain outside this change.
