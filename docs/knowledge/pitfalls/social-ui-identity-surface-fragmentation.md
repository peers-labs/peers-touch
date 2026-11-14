---
kind: pitfall
title: Social UI surfaces must not fragment identity
status: active
owns:
  - packages/ui/web/src/moment-card.tsx
  - packages/ui/web/src/moments.css
  - apps/desktop/src/pages/moments/
  - apps/desktop/src/components/moments/
  - apps/desktop/src/components/profile/
  - docs/client/common/ui-identity/
referenced-by:
  - docs/knowledge/invariants/client-ui-identity-before-edit.md
  - docs/knowledge/playbooks/ux-case-to-contract.md
related:
  - docs/client/common/ux-design-methodology.md
  - docs/client/common/ui-identity/README.md
  - docs/client/common/ui-identity/modules/social/desktop.md
detected: 2026-06-18
---

# Social UI surfaces must not fragment identity

## Symptom

The Social desktop page looked assembled rather than designed:

- The outer page rail, feed card borders, sidebar cards, and composer card each declared their own boundary.
- The tab control and primary `New Post` action used different visual systems and did not read as one scope header.
- The detail page rendered the post, comments, and reply composer as separate surfaces instead of one continuous thread.
- Trust context (`source -> reason -> audience`) was rendered as ad-hoc text, so federation meaning had no stable visual grammar.
- Incomplete Social capabilities risked appearing as broken empty UI instead of explicit `empty`, `loading`, `degraded`, `unavailable`, or `not implemented` states.

## Root Cause

The implementation used component-library primitives (`antd` `Card` / `Segmented` / `Typography`, `@lobehub/ui` `Button`) directly at feature level without first passing through the Peers Touch UI Identity contract. Each page/component made local decisions about radius, spacing, border, action size, and state presentation, so the module did not have a single content rail, scope bar, action row, trust meta line, or thread surface.

The methodological error was treating UI ID as a style preference instead of a reusable contract. Once incomplete protocol capability entered the UI, there was no required distinction between "no data" and "not implemented yet", so unfinished Social paths could look visually broken.

## Mitigation

### What was done in code

- `packages/ui` owns the scope bar, MomentCard, composer, Circle editor, identity
  popover, reactions, comments, media, overlays and feedback presentation.
- Social adapters bind original Native/Proto projections and commands to those
  components. Detail renders one shared MomentCard containing the comment thread;
  Back sits above it. No app-local thread frame or duplicate comment renderer remains.
- Empty and private status adapters use shared Empty, Spin and Alert, retaining
  the original distinctions between loading, empty, degraded and denied states.
- Private Image/VideoPlayer/Lightbox consume only authorized native media handles.
  Revocation removes the preview resource; shared playback teardown releases it.
- App owns one window-local SDK FeedbackChannel. Social consumers capture the
  completed Actor/Station/session-epoch scope; late callbacks and unmounted
  consumers cannot publish into another session. Scope changes dismiss active
  notices and settle queued confirmations.
- Circle block proof uses the original IdentityTrigger control and reciprocal
  relationship denial. Account epoch proof prepares accounts before scenario
  entry, switches through the original PIN runtime, then observes the secondary
  account's painted empty Circle state and the primary's canonical readback.
  The PIN switch is a prepared Native fixture command, not an Auth UI proof.
- Comment rows, previews, and reply-target labels use `useActorIdentity` with
  canonical profiles. Public comment DTOs may contain only an account handle;
  reading their author fields directly loses the persisted name and portrait.
- `PublicProfileCard` uses `UserSquareAvatar` to materialize Station-relative
  avatar references through the existing native avatar cache. Direct image
  rendering showed a broken portrait in Chat detail while Chat rows and
  comments rendered that same actor correctly.

### What guards against regression

卡片、作者、信任行、反应条和个人头部的当前唯一展示 Owner 是
`packages/ui/web/src/moment-card.tsx` / `moments.css`。原型与生产均消费同源组件；
app 的 MomentCard、SocialActionBar、SocialTrustMeta、UserProfileHeader 只适配原数据和命令。
circle/composer/thread 同样消费共享组件，不能重新在 app 内复制上述展示。
原 `north-star.suite.json` 与 `boards.suite.json` 绑定共享源码及焦点/长文案/禁用场景。

- `pnpm run check` in `apps/desktop/` must pass after Social UI edits.
- Future Social UI work must load `docs/client/common/ui-identity/README.md` and `docs/client/common/ui-identity/modules/social/desktop.md` before editing.
- Feature components compose `packages/ui`; `components/moments/surfaces/`
  contains business adapters rather than another presentation library.

## How to Detect a Recurrence

Run these checks during review:

- `rg "Card|Segmented|borderRadius|marginBottom|source.*reason.*audience" apps/desktop/src/pages/moments apps/desktop/src/components/moments --glob '!**/surfaces/**'`
- `rg "MomentCard|CommentList|MomentComposer" apps/desktop/src/pages/moments/MomentDetailPage.tsx`
- `rg "comment.author\\?\\.|replyTarget.author\\?\\.|c.author\\?\\." apps/desktop/src/components/moments` — comment identity must resolve through the shared actor profile projection.
- `rg "src=\\{profile.avatar\\}" apps/desktop/src/components/profile` — native profile cards must use the shared avatar renderer.
- `rg "not-implemented|degraded|unavailable" apps/desktop/src/components/moments/surfaces docs/client/common/ui-identity/modules/social`

Interpretation:

- Direct feature-level `Card` / `Segmented` / inline radius is not automatically wrong, but every occurrence must explain why an existing Social surface cannot own that boundary.
- `MomentDetailPage.tsx` delegates the complete post/comments surface to the
  shared MomentCard and must not introduce a competing thread frame.
- Any newly exposed incomplete Social capability must map to one of the explicit state kinds instead of borrowing a generic empty state.

## Crosswalks

- Invariant: `docs/knowledge/invariants/client-ui-identity-before-edit.md`.
- Playbook: `docs/knowledge/playbooks/ux-case-to-contract.md`.
- Contract: `docs/client/common/ui-identity/modules/social/desktop.md`.
