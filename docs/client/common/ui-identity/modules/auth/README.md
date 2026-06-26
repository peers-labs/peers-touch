# Auth UI Identity

> Status: Canonical module UI identity for sign-in, account selection, and station handoff.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-20.

## 1. Purpose

Auth is the first surface a user sees. It must make a federated, decentralized
product feel trustworthy and calm before any content exists.

Auth is also the surface most tempted to "wow" the user with decorative
visuals. This contract exists because a sign-in screen can be functionally
correct and still look like a stitched-together demo: an animated hero on one
side and a plain form on the other, two visual languages that do not belong to
the same product.

Current scope:

- Account selection (returning accounts), email/OAuth sign-in, PIN entry,
  PIN set/relink, expired-session re-auth.
- Station context: which station the user is joining, and the federated mesh
  that explains why Peers Touch is not a single-server app.
- Network topology illustration as ambient product education, not as a feature.

## 2. Inherited Identity

Auth inherits [Quiet Protocol Minimalism](../../README.md).

Auth-specific interpretation:

- Quiet: the sign-in task is the only thing that should pull attention.
- Protocol: station and federation context are explained, never shouted.
- Minimalism: one dominant surface (the auth card), one calm backdrop.
- Human-first: the account, the person, and the chosen station read as people
  and places, never as raw IPs, ports, or protocol identifiers.
- Verifiable: the active station and connection state are visible and truthful.

## 3. Auth Product Promise

Every Auth surface should answer:

- Who am I signing in as?
- Which station am I joining?
- Why is this a network and not a single app?
- Is this connection real and trustworthy right now?
- What is the single next action?

The screen should answer these without turning the background into a
developer console or a game.

## 4. Visual Model

Auth uses **one dominant card over one calm backdrop**.

Rules:

- The auth card is the only foreground surface. It owns radius, shadow, and the
  brand accent exactly as defined in shared tokens.
- Any ambient illustration (the federated mesh) is a **backdrop layer**: it must
  recede behind the card and must never compete for attention.
- The card and the backdrop must read as the same product: shared accent color,
  shared corner language, shared type scale. No second visual system.
- The backdrop must never cover, overlap, or crowd the card or its content.
- Decorative motion is forbidden. Motion is allowed only to clarify a state
  transition (for example, the chosen station replacing the placeholder node).

## 5. Auth Surface Hierarchy

Priority order:

1. The auth task: account list, sign-in form, PIN entry, primary CTA.
2. Identity context: account name, avatar, provider, chosen station name.
3. Trust/connection state: active station, online indicator, expired-session
   notice, secured badge.
4. Federation education: the network mesh and entity labels.
5. Ambient decoration: nothing beyond the calm backdrop itself.

Rules:

- Federation education (level 4) must never visually outrank the auth task
  (level 1). If the mesh dominates the screenshot, the hierarchy is wrong.
- Use the single brand accent for the mesh. Multi-color token sets, glows, and
  drop shadows on the backdrop are forbidden.
- Never render raw protocol values (IP, port, host, internal ids, raw i18n
  keys) as user-facing labels. Use friendly names or localized placeholders.

## 6. Federation Mesh As Ambient Education

The mesh teaches the federated model. It is the clearest case where decoration
can quietly violate the identity, so it carries explicit constraints.

| Aspect | Requirement |
| --- | --- |
| Purpose | Explain decentralization at a glance; it is education, not a feature. |
| Color | Brand accent only; no secondary decorative palette. |
| Nodes | Human/role/place names (Alice, Station, Relay, Service, Agent, Storage), never raw IP/host. |
| Center | No center node. The network must not imply a single hub. |
| Motion | Only data-flow tokens drift along edges and the station-swap transition; no swaying, sweeping, or pulsing decoration. |
| Placement | Confined so the auth card never covers a node; fade the mesh near the card edge. |
| Selected node | Reflects the user's chosen station with a friendly name, not a protocol string. |
| Reduced motion | Honors `prefers-reduced-motion`; data-flow stops. |

## 7. Required Auth Documents

- [desktop.md](./desktop.md) — Desktop-specific Auth surface constraints.

## 8. Covered UX Dimensions

This module contract covers:

- Task success for account selection, sign-in, PIN, and re-auth.
- Visual continuity between the auth card and the federated backdrop.
- Information hierarchy for the auth task vs. federation education.
- Truthful representation of station and connection state.
- Extreme data for long account names, long station names, and missing labels.

Out of scope:

- OAuth/backend protocol design and session persistence.
- Station selection logic (only its UI representation).
- Exact component implementation details.

## 9. AI Agent Checklist

- [ ] Does the auth card visually dominate the backdrop?
- [ ] Do the card and backdrop read as one product (accent, radius, type)?
- [ ] Does the backdrop avoid covering or crowding the card and its content?
- [ ] Is the mesh single-accent with no decorative glow or multi-color tokens?
- [ ] Are all node/station labels friendly names, never raw IP/host/keys?
- [ ] Is motion limited to data flow and state transitions, with reduced-motion honored?
- [ ] Is there exactly one primary next action per state?
