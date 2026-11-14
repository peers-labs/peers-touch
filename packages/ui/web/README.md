# Peers UI Web

Public presentation components are exported from `src/index.ts`. Contract catalogue:
`../contracts/src/catalogue.ts`. Tokens, semantics and resource authorization remain with
their original owners.

Social shared presentation:

- `identity-card.tsx`: IdentityCard, IdentityTrigger and controlled FollowButton.
  Consumers provide localized copy, canonical identity, relationships and command state.
- `image-grid.tsx`: bounded ImageGrid and its Lightbox. Consumers provide ResourceView
  or the original native resource renderer; the library does not resolve/download bytes.
- `moment-card.tsx`: MomentCard/Author/TrustMeta/ReactionBar, UserProfileHeader and StatGrid.
  Consumers supply localized labels, canonical identity, commands, content and inline-thread slots.
- `moment-comments.tsx`: canonical-identity comment rows, nested reply blocks and input/status composition.
  Thread order, drafts, mentions, IME and private/public commands stay in their original owners.
- `moment-scope-bar.tsx`: controlled scope, nearby search and a fixed action slot, shared by prototype
  and production. The library owns collapsed-field focus and geometry.
- `moment-composer.tsx`: controlled editor, images, audience and owner status/actions.
  Native picker, upload, draft persistence and public/private validity remain outside UI.
- `moment-circles.tsx`: Circle card and draft editor; cancellation writes no membership.
  Original Circle command results and readback decide save completion.
- `feed-sort-float.tsx`: controlled reader order plus the scroll-host-bound back-to-top morph.
  The library owns listeners and intrinsic stage measurement; Runtime owns data order.

Prototype state samples live in `packages/prototypes/shared/ui-system/ElementSamples.tsx`.
Original runtime probes are `north-star.suite.json` and `boards.suite.json`; these prove
presentation behavior, not signed-feed or Native product acceptance.
