---
kind: pitfall
title: Peer avatar projection token must not become the cache identity
status: active
owns:
  - apps/desktop/src-tauri/src/application/profile/mod.rs
  - apps/desktop/src/services/avatarAssets.ts
  - apps/desktop/src/store/socialProfileProjection.ts
  - apps/desktop/src/store/friendshipProjection.ts
  - apps/desktop/src/store/socialChat.ts
  - apps/desktop/src/components/common/useActorIdentity.ts
  - apps/desktop/src/components/profile/profileModel.ts
  - apps/desktop/src/components/chat/ChatContactsPanel.tsx
  - apps/desktop/src/components/chat/ChatDetailPanel.tsx
  - apps/desktop/src/components/chat/message/MessageSenderProfileCard.tsx
  - apps/desktop/src/components/settings/BotsSettings.tsx
related:
  - ../invariants/desktop-identity-lifecycle-closure.md
  - actor-profile-routing-fields-must-survive-projection.md
  - ../../client/desktop/identity-lifecycle.md
detected: 2026-10-31
owner: desktop-social
review-cadence: annual
next-review: 2027-10-31
---

# Peer avatar projection token must not become the cache identity

## Symptom

Already-friend avatars in the Direct list, group slots, message rows and peer
profile cards flashed to a letter / neutral placeholder and reloaded (sometimes
for seconds) every time the peer profile was refetched or the app restarted.
The image bytes were already cached on local disk.

## Root cause

`resolve_profile_urls` in the profile application edge overwrote the raw
Station profile value with the per-process
`station-resource://local/<ulid>` projection, and exposed no canonical field.
The projector token is ephemeral by design: it rotates on process restart,
Station lifecycle-generation change, and LRU eviction (4096 entries). The
renderer avatar owner keys entries on the full identity string, so every token
rotation produced a new key, a blank entry, and a fresh native resolution of
an already-cached image. After restart a token persisted from the previous
process cannot even be reverse-resolved (`UnknownProjection` / `StaleScope`).

The self path already honoured the contract — `sync_user_profile` keeps
`avatar_identity` (raw Station path / external URL / data URI) separate from
the projected URL — but `peer_profile_get` / `profile_get`
(`actor_profile_to_value`) did not. A secondary defect painted initials while
the identity was still unknown (`absent` was confused with "not loaded yet").

## Mitigation

### What was done in code

- Profile edge emits both fields: projected `avatar`/`header` for direct-src
  consumers (and back-compat) plus canonical `avatar_identity`/`header_identity`
  captured from the raw value BEFORE projection.
- The renderer selects identity through one helper,
  `canonicalProfileAvatar` (`socialProfileProjection.ts`):
  `avatar_identity` first, projected `avatar` only as a fallback.
  `resolveActorIdentity`, `useActorIdentity`, `profileModel.mergeAccountProfile`,
  `projectChatFriendContacts`, the contact request cards, the IM Direct
  conversation projection, the group-detail member map, the message-sender
  profile card, bot settings, and the `loadPeerProfile` prewarm all key on the
  canonical identity. CSS banner backgrounds and settings <img> still consume
  the projected `header`/`avatar` render URL directly.
- Avatar continuity: `AvatarAssetsStore.request` seeds a same-actor
  last-good snapshot (owner-gated by `actorPtid`) before starting a flight;
  every avatar mount attributes its owner PTID; an identity that has not
  loaded yet is `unresolved` (neutral placeholder), never authoritatively
  `absent`.

### What guards against regression

- Static Gate `test_peer_profile_edge_exposes_stable_avatar_identity` in
  `tooling/acceptance/gates/chat/native_product_closure_static_test.py`
  asserts the Rust edge emits `<field>_identity` before projecting, the TS
  contract carries the fields, and the projection/store actually use them.
- Static Gates
  `test_avatar_surfaces_attribute_owner_ptid_for_flicker_free_assets` and
  `test_avatar_owner_keeps_last_good_while_a_rotated_identity_resolves`.
- Rust unit tests in `application/profile/mod.rs`; TS tests in
  `socialProfileProjection.test.ts` and `avatarAssets.test.ts`.
- Feature constraint in
  `tooling/acceptance/features/chat-native-visible-clients.yaml` (canonical
  identity edge + cache key).

## How to detect a recurrence

```bash
cd apps/desktop/src-tauri && cargo test application::profile
pnpm --dir apps/desktop exec vitest run \
  src/store/socialProfileProjection.test.ts \
  src/services/avatarAssets.test.ts
/opt/homebrew/bin/python3.13 -m pytest \
  tooling/acceptance/gates/chat/native_product_closure_static_test.py
```

Manual: with an existing friend set, restart Desktop and refetch/refresh the
conversation list. Avatars must never pass through a letter/blank frame, and
repeated `peer_profile_get` responses must not trigger re-decodes for
unchanged canonical identities.

## Crosswalks

- Invariant `invariants/desktop-identity-lifecycle-closure.md` owns the
  identity/avatar state-machine closure (r3.1 Identity/Avatar).
- Pitfall `actor-profile-routing-fields-must-survive-projection.md` is the
  same projection edge failing a different class of canonical fields.
