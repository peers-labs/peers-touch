# UI Identity Foundations

> Status: Canonical client-level UI identity foundation.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. North Star

Peers Touch should feel like a modern social and collaboration product for a federated world, not an admin dashboard, not a forum, and not a raw protocol console.

The product must communicate:

- Who is acting.
- Where the activity comes from.
- Why it is visible.
- Who can see or affect it.
- Whether trust, privacy, permission, or moderation changes the user's next action.

The UI must communicate those answers without making every screen look like a developer tool.

## 2. Style Thesis

Peers Touch uses **Quiet Protocol Minimalism**.

### Quiet

The interface should be calm enough for daily use.

Rules:

- Prefer whitespace, alignment, and typography over heavy boxes.
- Prefer one clear primary action over many competing action colors.
- Avoid decorative borders, decorative gradients, and unnecessary badges.
- Use motion only to clarify state transition, never to attract attention.

### Protocol

Federation, identity, station, audience, and moderation are product facts, not debug metadata.

Rules:

- Surface protocol state where it changes interpretation or action.
- Compress stable protocol context into meta lines or trust chips.
- Expand sensitive or confusing protocol context on demand.
- Never invent trust or moderation state locally when the backend owns the truth.

### Minimalism

Minimalism means fewer competing structures, not less information.

Rules:

- One surface should have one dominant reading path.
- Related controls should share one spatial system.
- The UI should reveal secondary detail progressively.
- Empty state, loading state, and error state should be as designed as the happy path.

### Human-First

The current product phase prioritizes Human social and Human collaboration.

Rules:

- Human content is primary.
- Station and protocol context explain content; they do not visually dominate it.
- Agent, Applet, and automation affordances remain extension points unless the module contract explicitly activates them.

## 3. Visual Personality

| Dimension | Target | Avoid |
| --- | --- | --- |
| Overall mood | calm, modern, trustworthy | noisy, gamified, dashboard-like |
| Structure | soft hierarchy, crisp alignment | heavy nested cards, thick outlines |
| Density | high information density with low visual noise | sparse SaaS hero layout, cramped tables |
| Accent | disciplined single-accent system | mixed blue/purple/red/black CTAs |
| Surfaces | continuous social flows | stitched component-library defaults |
| Trust state | visible and contextual | hidden, inferred, or debug-like |

## 4. Boundary Philosophy

Visual quality starts with boundary ownership.

Every client surface must declare:

- Page bounds: what area belongs to the page.
- Content rail: where primary reading happens.
- Action bounds: where primary and secondary actions live.
- Trust bounds: where identity, station, audience, permission, and moderation are explained.
- Floating bounds: where popovers, menus, pickers, and tooltips may appear.
- Recovery bounds: where errors, retry, and partial failure appear.

If a surface has unclear boundaries, do not fix it with colors. Redesign the boundary model first.

## 5. Product Language

Peers Touch UI should prefer this language:

- "Activity" over "record" when the object is social or human-readable.
- "Source" over "origin" when explaining where content came from.
- "Audience" over "visibility setting" when explaining who can see.
- "Reason" over "rule" when explaining why content appears.
- "Trust" over "security" when the user is deciding whether to interact.

Module contracts may refine terms, but must keep the same semantic intent.

## 6. Covered UX Dimensions

This foundation covers:

- Visual continuity.
- Information hierarchy.
- Spatial boundaries.
- Trust and safety.
- Platform fit at the semantic level.

Out of scope:

- Concrete Desktop/Mobile component implementation.
- Module-specific content strategy.
- Exact coded token values.
- Accessibility test procedures beyond the foundation-level requirement.

## 7. AI Agent Checklist

- [ ] Does the screen feel like one product, not mixed libraries?
- [ ] Does the primary content read before protocol metadata?
- [ ] Are protocol/trust states visible only where they affect interpretation or action?
- [ ] Are boundaries defined before styling?
- [ ] Are action colors disciplined and consistent?
- [ ] Is the screen free from admin-dashboard visual language unless the module is explicitly an admin module?
