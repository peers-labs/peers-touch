---
kind: invariant
title: Mobile user identity is visually canonical
status: active
owns:
  - apps/mobile/src/components/MobileAvatar.tsx
  - apps/mobile/src/features/social/SocialActorAvatar.tsx
  - apps/mobile/src/features/social/useSocialActorIdentity.ts
  - apps/mobile/src/pages/moments/
  - apps/mobile/src/services/gateways/momentsGateway.ts
  - packages/prototypes/mobile/chat/
referenced-by: []
related:
  - docs/client/common/ui-identity/components.md
  - docs/client/common/ui-identity/modules/social/README.md
  - docs/client/common/ui-identity/tokens.md
detected: 2026-10-09
---

# Mobile user identity is visually canonical

## What must hold

Every Mobile identity MUST render through `MobileAvatar` with an explicit
identity role. People use circular geometry; groups and other collective
identities use rounded-square geometry. Social surfaces MUST resolve display
name, avatar asset, and fallback color from the same canonical actor PTID
before rendering; a less-complete post, comment, notification, or search DTO
MUST NOT create a second visual identity. Interactive inputs and buttons MUST
NOT inherit avatar geometry.

## Why this is non-negotiable

An actor is a product identity, not a transport record. When a comment exposes
only `ActorRef.acct` while its parent post contains a complete author, rendering
those records independently makes one person appear to be two people. That
breaks trust in authorship and violates the Social product promise.

Role-specific identity geometry is also a shared product primitive. Allowing
feature-local avatar wrappers or unclassified antd defaults fragments Mobile
into unrelated visual systems even when the underlying identity is identical.

## How to verify

- `pnpm --dir apps/mobile exec vitest run src/components/MobileAvatar.test.tsx src/features/social/useSocialActorIdentity.test.ts src/pages/moments/MomentCommentsSection.test.tsx` must pass.
- `rg "SocialAvatar" apps/mobile/src/pages/moments apps/mobile/src/features/social` must return zero hits.
- `MobileAvatar.test.tsx` must prove circular person geometry and
  rounded-square group geometry.
- `packages/prototypes/mobile/chat/scripts/check-layout.mjs` must report zero
  defects for role-specific avatar geometry, fallback length, comment input
  radius, and send-button radius.
- Native evidence must show equal name/avatar presentation for one PTID in a post and its comment.

## Crosswalks

- `docs/client/common/ui-identity/components.md` defines the shared avatar and control geometry.
- `docs/client/common/ui-identity/modules/social/README.md` defines Social actor identity continuity.
