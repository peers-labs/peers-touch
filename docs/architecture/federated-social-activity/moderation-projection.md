# Federated Human Social Activity — Moderation Projection

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-17 | **Updated**: 2026-06-18
> **Owner**: Architecture Team

---

## 1. Purpose

Moderation projection defines how Human federated social surfaces explain blocked or suppressed content without letting Desktop invent policy state.

This document exists because actor block and station block are different product concepts:

- **Actor block** is a relationship rule between two Human Actors.
- **Station block** is a trust or moderation rule between the viewer's Station and another Station.
- **Feed exclusion** hides content that the viewer must not see.
- **Block explanation** explains a policy fact only when Station is allowed to reveal that fact.

Desktop may render moderation state, but Station must own the decision and the explanation.

---

## 2. Current Boundary

Current implemented behavior:

- Actor block uses the Station social block graph backed by `friend_chat_friendships`.
- Blocked actor content is excluded from timeline / Moments projection.
- Station-level moderation now has a proto-first policy source: `StationModerationPolicy` plus upsert / delete / list requests in `model/domain/social/post.proto`.
- Station persists station trust policy in `social_station_moderation_policies`.
- Timeline feed projection filters posts whose author home Station matches a blocked Station policy before building normal feed responses.
- Profile, search, follow, comment, and reaction gates consult the same Station moderation policy source.
- Desktop Rust and Desktop Web expose typed proto-byte bridges for station moderation commands / queries.
- Desktop Web publishes `moment.resync_requested` after station moderation upsert / delete succeeds.
- Returned feed objects currently carry `BLOCK_STATE_NOT_BLOCKED`.
- `BLOCK_STATE_VIEWER_BLOCKED_AUTHOR`, `BLOCK_STATE_AUTHOR_BLOCKED_VIEWER`, and `BLOCK_STATE_STATION_BLOCKED` are protocol reservations.

Current missing behavior:

- No audit-safe aggregate notice exists for explaining that a Station was suppressed without leaking private moderation notes.
- No Desktop UI may claim a Station is blocked unless Station returns that projection.

---

## 3. Product Semantics

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Viewer Station                                                               │
│                                                                              │
│  Human Actor ── actor block ──► Human Actor                                   │
│      │                                                                        │
│      └── station trust policy ──► Remote Station                              │
│                                                                              │
│ Feed projection answers:                                                      │
│ - Is this object allowed to appear?                                           │
│ - If it appears, what safe explanation can the viewer see?                    │
│ - If it is suppressed, should the UI show an aggregate notice or nothing?     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Station block is not a relationship between two users. It is a Station policy that can affect many actors and objects from the remote boundary.

---

## 4. Projection Rules

1. Suppressed objects do not enter normal feed responses.
2. Returned objects must carry a `BlockExplanation` supplied by Station.
3. `BLOCK_STATE_NOT_BLOCKED` means no moderation policy affected the returned object.
4. `BLOCK_STATE_STATION_BLOCKED` can only be returned by a Station moderation projection, never by Desktop inference.
5. Desktop may show aggregate moderation notices only from a Station-provided count or event, not from missing feed rows.
6. Search, profile, follow, comment, and reaction must consult the same policy source as feed projection.

---

## 5. Required Implementation Closure

| Layer | Required Work | Notes |
|------|---------------|-------|
| Proto | Add station moderation command / query contract | Done via `StationModerationPolicy`; no JSON-only policy model |
| Station domain | Define station moderation aggregate | Done for remote station domain / peer id, policy kind, reason, actor, audit fields |
| Station application | Apply policy to timeline, profile, search, interaction gates | Timeline feed exclusion and minimal action gates done |
| Station projection | Produce `BlockExplanation` and optional aggregate notice | Returned objects remain `NOT_BLOCKED`; aggregate notice still pending |
| Desktop Rust | Bridge generated proto bytes | Done for upsert / delete / list |
| Desktop Web | Render only Station-returned projection | Typed API wrappers done; no local station-block guessing |
| Tests | Actor block, station block, action gate, reconnect recovery | Focused TS runtime tests pass; Go test currently blocked by local module cache |

---

## 6. Non-Goals

- Do not implement station block as a hardcoded Desktop domain blacklist.
- Do not infer station block from absent feed items.
- Do not expose private moderation notes to users.
- Do not mix actor block state and station trust state in one UI label.
- Do not introduce Agent / A2A moderation behavior in the current Human-only phase.

---

## 7. Acceptance Before E2E

Before E2E-H07 can be considered ready, non-E2E implementation must prove:

- Station has a durable station moderation policy source.
- Feed projection and interaction gates read the same source.
- `BlockExplanation` is populated from Station, not from UI fallback logic.
- Runtime refresh after block / unblock / moderation changes updates `feedExplanations`.
- Focused tests cover at least one station-blocked feed exclusion and one blocked interaction.
