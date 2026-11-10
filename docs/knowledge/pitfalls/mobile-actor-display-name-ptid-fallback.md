---
kind: pitfall
title: actorDisplayName must distinguish PTID-derived handles from canonical-profile waits
status: active
owns:
  - apps/mobile/src/features/social/socialProjection.ts
  - apps/mobile/src/features/social/useSocialActorIdentity.ts
  - apps/mobile/src/pages/settings/useSettingsController.ts
  - apps/mobile/src/features/chat/AttachmentDetailHost.tsx
  - apps/mobile/scripts/check-mobile-shell-contracts.py
referenced-by: []
related:
  - docs/knowledge/pitfalls/mobile-whole-product-surface-audit-layers.md
detected: 2026-11-11
---

# actorDisplayName must distinguish PTID-derived handles from canonical-profile waits

## Symptom

Five baseline Mobile tests stayed red after the social refactor:

- contact / request-pagination projections produced empty `peerName` values
  for accepted contacts whose payload omitted a display name
- blocked-user settings rendered an empty name instead of the canonical PTID
- the Chat history static-markup test crashed with
  `Missing getServerSnapshot` from `useSyncExternalStore`

## Root cause

A refactor collapsed `actorDisplayName(displayName, actorPtid)` into a strict
sanitizer that ignored its second argument and returned `''` for every
technical candidate (PTID, DID, HTTP URL, email-like string). That satisfied
comment-transport identities, which must wait for the canonical profile, but
silently deleted the PTID handle derivation that contact projections rely on.
Two different callers encode opposite requirements:

- `resolveSocialActorIdentity` always calls the helper with an **empty** PTID
  and expects `''` for a locator-only identity so the UI waits for a canonical
  profile rather than displaying a guessed name.
- `projectAcceptedContacts` passes the **real** peer PTID and expects a
  readable handle derived from it (`ptid:peer-119` → `Peer-119`;
  `ptid:v1:actor:...:alice:<hash>` → `Alice`).

`blockedUserViews` was rerouted through the same helper, which humanized
unresolved blocked identities; its established contract is the raw canonical
PTID fallback (`profile.displayName || profile.acct || targetPtid`) so an
unconfirmed identity never looks like a verified display name.

Separately, `AttachmentDetailHost` called `useSyncExternalStore` without a
server snapshot; static markup rendering has no selection state and React
requires `getServerSnapshot` to exist.

## Mitigation

The helper branches on whether a PTID context exists:

1. a clean, non-technical display name is returned as-is (the strict
   null/PTID/DID/URL/email filters are retained);
2. with no PTID argument it returns `''`, preserving the canonical-profile
   wait for comment identities;
3. with a PTID it derives a humanized handle from the path — the
   second-to-last segment of a structured `...:actor:...:<handle>:<hash>`
   PTID, or the last segment of a simple two-segment PTID — skipping
   32+ character hex hash segments, and falling back to the raw locator;
4. `blockedUserViews` keeps its own raw-PTID fallback and does not call the
   humanizer;
5. transient client-only external stores pass `() => null` as the
   `getServerSnapshot` argument.

The shell contract checker was realigned in the same change: the north-star
prototype deleted its antd-era second skin (`AuthGateScreen`, `MobileShell`,
`ExperienceRecovery`) and now renders the same `@peers-touch/ui` components,
so class-level `mp-*` parity assertions were replaced with shared-system
contract checks while every production-side assertion stayed intact.

## How to detect a recurrence

- `npx vitest run` from `apps/mobile` — the contact journey, request
  pagination, settings identity, registry and Chat history tests pin each
  branch and fail immediately on a regression.
- `python3 scripts/check-mobile-shell-contracts.py` (and `-- --hard-cut`)
  validates the production Auth/Recovery contracts and the north-star
  prototype shared-skin anatomy.
- When changing identity rendering, decide first whether the caller owns a
  PTID context; a helper that humanizes for one caller must not invent names
  for callers that are explicitly waiting on a canonical profile.
