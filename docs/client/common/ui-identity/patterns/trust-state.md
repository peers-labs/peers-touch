# Trust State Pattern

> Status: Shared UI pattern for trust, identity, privacy, and policy states.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-10-12.

## 1. Purpose

Peers Touch is a federated product. UI must expose trust boundaries when they affect user decisions.

This pattern applies to station source, actor identity, audience, privacy, permission, moderation, block, degraded runtime, and remote capability states.

## 2. Trust Promise

A trust-state UI must answer:

- What is the state?
- Who or what is the authority?
- How does it affect visibility or action?
- Is it final, pending, degraded, unavailable, or unknown?
- What can the user do next?

## 3. Authority Rules

Trust state must name its authority.

Examples:

- Audience is authored by the posting model/station contract.
- Station moderation is authored by Station policy projection.
- Actor block is authored by relationship/block projection.
- Runtime degraded state is authored by Desktop runtime health.
- Local draft privacy is authored by the composer state.

Rules:

- Do not infer policy from missing data.
- Do not present pending command state as committed policy.
- Do not merge actor block and station block into one visual state.
- If authority is unknown, show unknown/degraded only when useful; otherwise keep metadata quiet.

## 4. Visual Levels

| Level | Meaning | Visual treatment |
| --- | --- | --- |
| Quiet meta | stable source/audience/reason | inline meta line |
| Informational | useful context | quiet chip or tooltip |
| Attention | degraded or partial state | inline notice near affected surface |
| Blocking | action denied or content hidden | explicit recovery/trust surface |
| Dangerous | destructive policy action | confirmation and clear authority |

Rules:

- Stable federation metadata should not look like an error.
- Blocking state must not be hidden inside a tooltip.
- Dangerous policy actions must be visually separated from routine actions.

### 4.1 Two axes: loudness and decision distance

The table above is the **loudness** axis (how strongly a single trust fact is
rendered). It does not answer **where or when** the fact appears. Both axes are
required; picking a loudness is not a license to show infrastructure everywhere.

The second axis is **decision distance**: how close the current surface is to a
trust decision. Peers Touch federation facts (station ownership, relay path,
identity verification, audience/authority) elevate only as the user approaches a
decision about trust, and stay hidden inside the live conversation.

| Placement stage | Surface / moment | Default treatment |
| --- | --- | --- |
| In-flow hidden | message stream, composer, conversation title | no station/relay/verification chrome; only the person and content |
| Deviation cue | list row / item where the relationship differs from the default (cross-station federation, unverified) | at most one minimal mark on the deviating item; the same-station default carries no mark; never a border/ring around the avatar (reads as selection) |
| On-demand detail | conversation/contact detail, profile, source inspector | fully readable, but ordered by user weight: who/how-to-recognize first, then trust in human language, with station identity, relay path, addresses, and policy last and behind plain language |
| Decision moment | first cross-station connection, identity verification, safety warning, recovery | full expressive treatment is allowed, but it leads with human meaning; brand/federation strength surfaces here while literal node paths stay supporting disclosure, never the hero |

Rules:

- Default (same station, verified) is silent. Only deviations earn a cue; never
  tag every row with its relay or station.
- The same fact uses the placement stage for *where* and the Visual Levels table
  for *how loud*. Example: a degraded remote station at list scope is a
  Deviation cue rendered at "Attention", never "Blocking", unless the user's
  current action is actually denied.
- **Path-failure exception**: when federation delivery itself becomes a
  perceptible state (slow relay, failed cross-station delivery), surface it
  locally and quietly on that message as delivery feedback, independent of a
  trust decision. In practice infrastructure appears in exactly two cases: at a
  trust decision point, or when the path fails.
- Brand-expression strength (see `new-identity.md`) is concentrated at the
  Decision-moment stage; the In-flow stage follows Quiet Protocol Minimalism.
- **Recognition before plumbing**: inside any one surface, order content by what
  the user is deciding, not by the technical model. Who the person is and how to
  recognize them comes first; network, station address, relay route, and
  identifiers come last. Network is important but rarely attended, so it sinks
  to the bottom rather than competing with the person.
- **Addresses are locators, not identity**: a station domain, relay id, or PTID
  exists so the user can find and verify the other party; it is never the
  headline. Primary surfaces carry no raw infrastructure vocabulary — no "P2P",
  relay/node ids, hop diagrams, station domains, or key hashes. Render the human
  meaning instead (for example "from another network") and put the literal
  address/route behind an explicit technical/advanced disclosure for users who
  want it.
- **Decision moments explain, they do not dump topology**: the ceremony may be
  rich in human and brand terms, but the lead is a plain-language statement of
  what changes for the user; the YOU → relay → station path is secondary detail,
  never the visual hero.

### 4.2 Worked placement: a chat conversation

- Conversation header during an active chat is **In-flow hidden**: do not carry
  station pills, verification badges, or relay text there. End-to-end encryption
  is the default-safe baseline and stays visually neutral, not attention-colored.
- Conversation/contact detail is **On-demand detail** and is ordered
  recognition-first: name/face and how the user knows the person, then trust in
  human language (verified identity, end-to-end encrypted). Station identity,
  relay path, governing policy, and raw addresses sink to the bottom, rendered in
  plain language with the literal domain/route/hash behind an explicit technical
  disclosure.
- First cross-station link and safety-number verification are **Decision moment**
  and may use the stronger expressive treatment. The headline is a plain-language
  statement ("someone outside your usual network"), not a node diagram; the
  YOU → relay → station route is supporting detail at the bottom.
- The list row for a cross-station peer is **Deviation cue**, but the avatar
  itself stays clean: do **not** draw a ring/border around it (it reads as
  selection or focus). The list cue, when shown, is at most one minimal mark
  that never competes with the presence dot or the selection indicator; a
  same-station peer carries none. The human meaning ("from another network")
  is expressed on the contact/conversation detail surface and on hover, never
  as a domain or relay id.

## 5. State Taxonomy

Use these labels in design and implementation discussions:

- `known`: authoritative state is available.
- `pending`: command sent, authority not yet confirmed.
- `degraded`: authority or runtime is reachable only partially.
- `unavailable`: capability is not available in this context.
- `unknown`: state is not known and should not be interpreted.
- `blocked`: authority confirms the action/content is blocked.
- `hidden`: authority confirms content is hidden by policy.

## 6. Social Application

For Social:

- Source/audience/reason usually use quiet meta.
- Remote station unavailable uses attention state only if it affects current action.
- Station block uses blocking state only when Station policy projection confirms it.
- Moderation command pending uses pending state near the moderation action.
- Missing aggregate projection means no aggregate block notice, not a fake one.

## 7. AI Agent Checklist

- [ ] Did I identify the authority for the trust state?
- [ ] Did I distinguish known, pending, degraded, unavailable, unknown, blocked, and hidden?
- [ ] Did I avoid inferring policy from missing data?
- [ ] Is the visual level proportional to user impact?
- [ ] Is dangerous policy action separated from routine action?
- [ ] Did I place the fact on the decision-distance axis (In-flow hidden,
      Deviation cue, On-demand detail, Decision moment), not only choose a loudness?
- [ ] Does the default case stay silent, with cues only on deviating items?
- [ ] Is infrastructure absent from the live conversation unless it is a trust
      decision point or a delivery/path failure?
- [ ] Is the surface ordered recognition-first, with network, station address,
      relay route, and identifiers pushed to the bottom or behind a technical
      disclosure?
- [ ] Is infrastructure expressed in human language, with no raw jargon (P2P,
      relay/node ids, hop diagrams, station domains, key hashes) on a primary
      surface?
- [ ] Does a decision moment lead with what changes for the user, keeping the
      node path as supporting detail rather than the hero?
