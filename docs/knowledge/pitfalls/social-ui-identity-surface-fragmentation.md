---
kind: pitfall
title: Social UI surfaces must not fragment identity
status: active
owns:
  - apps/desktop/src/pages/moments/
  - apps/desktop/src/components/moments/
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

- Added Social surface primitives under `apps/desktop/src/components/moments/surfaces/`.
- Moved the page column into `SocialContentRail` and the title/tabs/primary action into `SocialScopeBar`.
- Replaced ad-hoc `source · reason · audience` text with `SocialTrustMeta`.
- Replaced split reaction/comment controls with `SocialActionBar`.
- Wrapped detail post + comments + reply composer in `SocialThreadSurface`.
- Added `SocialEmptyState` so incomplete capability states are explicit and visually consistent.
- Removed the standalone outer card from `MomentComposer`; callers now place it inside the correct Social surface.

### What guards against regression

- `pnpm run check` in `apps/desktop/` must pass after Social UI edits.
- Future Social UI work must load `docs/client/common/ui-identity/README.md` and `docs/client/common/ui-identity/modules/social/desktop.md` before editing.
- Feature components under `apps/desktop/src/pages/moments/` and `apps/desktop/src/components/moments/` should compose `components/moments/surfaces/` instead of declaring new top-level card, rail, thread, action, or trust meta styles inline.

## How to Detect a Recurrence

Run these checks during review:

- `rg "Card|Segmented|borderRadius|marginBottom|source.*reason.*audience" apps/desktop/src/pages/moments apps/desktop/src/components/moments --glob '!**/surfaces/**'`
- `rg "MomentCard|CommentList|MomentComposer" apps/desktop/src/pages/moments/MomentDetailPage.tsx`
- `rg "not-implemented|degraded|unavailable" apps/desktop/src/components/moments/surfaces docs/client/common/ui-identity/modules/social`

Interpretation:

- Direct feature-level `Card` / `Segmented` / inline radius is not automatically wrong, but every occurrence must explain why an existing Social surface cannot own that boundary.
- `MomentDetailPage.tsx` may render `MomentCard`, `CommentList`, and `MomentComposer`, but they must be inside one `SocialThreadSurface` and must not introduce competing outer cards.
- Any newly exposed incomplete Social capability must map to one of the explicit state kinds instead of borrowing a generic empty state.

## Crosswalks

- Invariant: `docs/knowledge/invariants/client-ui-identity-before-edit.md`.
- Playbook: `docs/knowledge/playbooks/ux-case-to-contract.md`.
- Contract: `docs/client/common/ui-identity/modules/social/desktop.md`.
